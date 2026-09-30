import * as THREE from 'three/webgpu';
import { AudioEngine } from '../audio/AudioEngine';
import { CameraRig } from '../camera/CameraRig';
import { readConfig, type AppConfig } from './config';
import { LevelController } from '../gameplay/LevelController';
import { PointerInput, type PickHit, type PointerHandler } from '../input/PointerInput';
import { LEVELS, LEVEL_ORDER, levelById, type LevelMeta } from '../levels/registry';
import { WorldMap, type MapNodeInfo } from '../map/WorldMap';
import { validateLevel, type LevelValidationReport } from '../puzzle/validation';
import { PostFX } from '../render/PostFX';
import { lowerQuality, QUALITY_PRESETS, type QualityLevel } from '../render/quality';
import { RendererManager } from '../render/RendererManager';
import { SaveStore, type Settings } from '../save/SaveStore';
import { UI, type MapCardInfo } from '../ui/UI';

type Screen = 'boot' | 'map' | 'loading' | 'level';

const raycaster = new THREE.Raycaster();
const ndcV = new THREE.Vector2();

/** Top-level game application: owns renderer, camera, input, audio, UI and the active screen. */
export class App {
  private cfg: AppConfig;
  private save: SaveStore;
  private ui!: UI;
  private renderer!: RendererManager;
  private post!: PostFX;
  private rig = new CameraRig();
  private input!: PointerInput;
  private audio: AudioEngine;
  private screen: Screen = 'boot';
  private map: WorldMap | null = null;
  private level: LevelController | null = null;
  private reports = new Map<string, LevelValidationReport>();
  private selectedMap: string | null = null;
  private clock = performance.now();
  private elapsed = 0;
  private fps = 60;
  private frameTimes: number[] = [];
  private benchDone = false;
  private debugTimer = 0;
  private busyLoading = false;
  private flashT = 0;
  readonly errors: string[] = [];

  constructor(private readonly root: HTMLElement) {
    this.cfg = readConfig();
    this.save = new SaveStore(LEVEL_ORDER);
    const s = this.save.settings;
    this.audio = new AudioEngine({ music: s.musicVolume, sfx: s.sfxVolume, ambience: s.ambienceVolume, muted: s.muted || this.cfg.mute });
  }

  async start(): Promise<void> {
    const stage = document.createElement('div');
    stage.className = 'stage';
    const uiRoot = document.createElement('div');
    uiRoot.className = 'ui-root';
    this.root.append(stage, uiRoot);
    this.ui = new UI(uiRoot, this.callbacks());
    this.ui.setTheme('map');
    this.ui.showBoot(0.1, 'Grafik wird vorbereitet …');

    const settings = this.save.settings;
    const quality: QualityLevel = this.cfg.quality ?? settings.quality;
    this.renderer = await RendererManager.create({ canvasParent: stage, forceWebGL: this.cfg.forceWebGL, quality, adaptive: this.cfg.adaptive });
    if (!this.cfg.quality && settings.qualityAuto && this.renderer.isSoftwareRenderer && quality !== 'low') {
      this.renderer.setQuality('low');
      this.save.updateSettings({ quality: 'low', qualityAuto: true });
    }
    this.post = new PostFX(this.renderer.renderer);
    this.rig.reducedMotion = settings.reducedMotion;
    this.rig.setAspect(this.renderer.width / this.renderer.height);
    this.renderer.onResize((w, h) => this.rig.setAspect(w / h));
    this.input = new PointerInput(this.renderer.canvas);
    this.installKeyboard();

    this.ui.showBoot(0.35, 'Rätsel werden geprüft …');
    for (const l of LEVELS) {
      const r = validateLevel(l.puzzle);
      this.reports.set(l.id, r);
      if (!r.ok) console.error(`[Riverbound] Level ${l.id} ist fehlerhaft:`, r.errors.join(' | '));
    }
    this.installQa();

    this.ui.showBoot(0.6, 'Welt wird geladen …');
    this.renderer.renderer.setAnimationLoop(() => this.frame());
    const lvl = this.cfg.level;
    if (lvl && levelById(lvl) && (this.save.isUnlocked(lvl) || this.cfg.qa)) {
      if (this.cfg.qa) this.save.unlockAll();
      await this.startLevel(lvl);
    } else {
      await this.showMapScreen();
    }
    this.ui.hideBoot();
  }

  // ───────────────────────── screens ─────────────────────────

  private mapNodes(): MapNodeInfo[] {
    return LEVELS.map((l) => {
      const r = this.save.record(l.id);
      return { id: l.id, name: l.name, unlocked: this.save.isUnlocked(l.id), completed: r.completed, stars: r.bestStars };
    });
  }

  private formatCost(l: LevelMeta, cost: number): string {
    return l.puzzle.cost.type === 'slowest' ? `${cost} ${l.puzzle.cost.unit}` : `${cost} ${cost === 1 ? 'Überfahrt' : 'Überfahrten'}`;
  }

  private mapCards(): MapCardInfo[] {
    return LEVELS.map((l) => {
      const r = this.save.record(l.id);
      const rep = this.reports.get(l.id)!;
      return {
        id: l.id,
        index: l.index,
        name: l.name,
        subtitle: l.subtitle,
        description: l.description,
        mechanic: l.mechanic,
        difficulty: l.difficulty,
        unlocked: this.save.isUnlocked(l.id),
        completed: r.completed,
        stars: r.bestStars,
        best: r.bestCost !== null ? this.formatCost(l, r.bestCost) : null,
        optimal: rep.optimal ? this.formatCost(l, rep.optimal.cost) : '—',
        valid: rep.ok,
      };
    });
  }

  private async showMapScreen(): Promise<void> {
    this.disposeLevel();
    this.screen = 'loading';
    this.ui.hideHud();
    this.ui.hideWin();
    this.ui.hideFail();
    this.ui.hidePause();
    this.ui.hideHint();
    this.ui.setTheme('map');
    if (!this.map) {
      this.map = new WorldMap({ quality: this.renderer.preset, renderer: this.renderer.renderer }, this.mapNodes());
      await this.map.build();
      await this.renderer.renderer.compileAsync(this.map.scene, this.rig.camera).catch(() => undefined);
    } else {
      this.map.updateNodes(this.mapNodes());
    }
    this.post.configure(this.map.scene, this.rig.camera, this.renderer.preset, this.map.look);
    this.rig.setLimits(this.map.camera.limits);
    this.rig.setHome(this.map.camera.home, true);
    this.input.handler = this.mapHandler();
    const cards = this.mapCards();
    this.ui.showMap(cards);
    const sel = this.selectedMap ?? this.save.snapshot.lastLevel ?? [...LEVELS].reverse().find((l) => this.save.isUnlocked(l.id))!.id;
    this.selectMap(sel, false);
    this.audio.playMusic('map');
    this.audio.playAmbience('map');
    this.ui.hideLoading();
    this.screen = 'map';
  }

  private selectMap(id: string | null, focus = true): void {
    this.selectedMap = id;
    this.map?.setSelected(id);
    const card = id ? this.mapCards().find((c) => c.id === id) ?? null : null;
    this.ui.selectMapCard(card);
    if (id && this.map) {
      // frame the island right of the info card (card occupies the left ~35 % of the screen)
      const p = this.map.nodePosition(id).clone();
      const az = this.rig.currentView.azimuth;
      const radius = Math.max(26, this.map.camera.home.radius * 0.62);
      p.x -= Math.cos(az) * radius * 0.28;
      p.z += Math.sin(az) * radius * 0.28;
      if (focus) this.rig.focus(p, radius);
      else this.rig.frame({ target: p, radius });
    }
  }

  private mapHandler(): PointerHandler {
    let hovered: string | null = null;
    const pickId = (x: number, y: number): string | null => {
      if (!this.map) return null;
      ndcV.set(x, y);
      raycaster.setFromCamera(ndcV, this.rig.camera);
      return this.map.pick(raycaster);
    };
    return {
      pick: (x, y) => {
        const id = pickId(x, y);
        return id ? { kind: 'mapNode', id } : null;
      },
      onHover: (hit, cx, cy) => {
        const id = hit?.id ?? null;
        if (id !== hovered) {
          hovered = id;
          this.map?.setHover(id);
          document.body.style.cursor = id ? 'pointer' : '';
          if (id) this.audio.play('hover');
        }
        if (id) {
          const l = levelById(id)!;
          const r = this.save.record(id);
          const unlocked = this.save.isUnlocked(id);
          this.ui.showTooltip(cx, cy, `${l.index}. ${l.name}`, [
            l.mechanic,
            unlocked ? (r.completed ? `Abgeschlossen · ${'★'.repeat(r.bestStars)}${'☆'.repeat(3 - r.bestStars)}` : 'Noch nicht gelöst') : 'Gesperrt – löse zuerst die vorige Welt',
            unlocked ? 'Klicken zum Auswählen, erneut klicken zum Reisen' : '',
          ].filter(Boolean));
        } else this.ui.hideTooltip();
      },
      onClick: (hit, button) => {
        if (button !== 0 || !hit) return;
        this.audio.play('click');
        if (hit.id === this.selectedMap && this.save.isUnlocked(hit.id)) void this.startLevel(hit.id);
        else this.selectMap(hit.id);
      },
      canDrag: () => false,
      onDragStart: () => {},
      onDragMove: () => {},
      onDragEnd: () => {},
      onDragCancel: () => {},
      rotateCamera: (dx, dy) => this.rig.rotate(dx, dy),
      panCamera: (dx, dy) => this.rig.pan(dx, dy),
      zoomCamera: (d) => this.rig.zoom(d),
    };
  }

  private disposeLevel(): void {
    if (this.level) {
      this.level.dispose();
      this.level = null;
    }
  }

  async startLevel(id: string): Promise<void> {
    if (this.busyLoading) return;
    const meta = levelById(id);
    if (!meta) return;
    const rep = this.reports.get(id)!;
    if (!rep.ok) {
      this.ui.toast('invalid', 'Level fehlerhaft', `Dieses Level hat die Prüfung nicht bestanden: ${rep.errors.join(' ')}`);
      return;
    }
    if (!this.save.isUnlocked(id)) {
      this.ui.toast('info', 'Noch gesperrt', 'Löse zuerst die vorherige Welt, um diese Reise freizuschalten.');
      return;
    }
    this.busyLoading = true;
    this.screen = 'loading';
    this.input.handler = null;
    this.ui.hideTooltip();
    this.ui.hideWin();
    this.ui.hideFail();
    this.ui.hidePause();
    this.ui.hideHint();
    this.ui.showLoading(meta.name, meta.subtitle);
    this.audio.play('transition');
    await new Promise((r) => setTimeout(r, 450));
    this.ui.hideMap();
    this.ui.hideHud();
    this.disposeLevel();
    try {
      const mod = await meta.load();
      const world = await mod.default({ quality: this.renderer.preset, renderer: this.renderer.renderer });
      this.level = new LevelController(meta, world, {
        rig: this.rig,
        ui: this.ui,
        audio: this.audio,
        reducedMotion: this.save.settings.reducedMotion,
        onWin: (r) => this.onWin(meta, r),
        onFlash: () => (this.flashT = 1),
      });
      this.ui.setTheme(meta.id);
      this.post.configure(world.scene, this.rig.camera, this.renderer.preset, world.look);
      this.rig.setLimits(world.camera.limits);
      this.rig.setHome(world.camera.home, true);
      await this.renderer.renderer.compileAsync(world.scene, this.rig.camera).catch(() => undefined);
      this.input.handler = this.level;
      this.save.markStarted(id);
      this.ui.showHud(this.level.hudState());
      this.audio.playMusic(world.music);
      this.audio.playAmbience(world.ambience);
      this.screen = 'level';
      this.ui.hideLoading();
      this.ui.toast('info', 'Kamera', 'WASD / Pfeiltasten: bewegen · Q / E: 360° drehen · R / F oder Mausrad: zoomen · T / G: neigen · C: zurücksetzen', 7000);
      this.busyLoading = false;
      const seen = this.save.snapshot.seenIntros.includes(id);
      const skip = this.save.settings.skipSeenIntros && seen;
      if (world.camera.intro.length >= 2 && !skip) {
        this.ui.setIntroSkip(true);
        await this.rig.playCinematic(world.camera.intro, { speed: this.cfg.qa ? 25 : this.save.settings.reducedMotion ? 2 : 1 });
        this.ui.setIntroSkip(false);
        this.save.markIntroSeen(id);
      }
    } catch (e) {
      console.error('[Riverbound] Level konnte nicht geladen werden', e);
      this.busyLoading = false;
      this.ui.hideLoading();
      this.ui.toast('invalid', 'Ladefehler', `Die Welt „${meta.name}“ konnte nicht geladen werden.`);
      await this.showMapScreen();
    }
  }

  private onWin(meta: LevelMeta, r: { cost: number; moves: number; stars: number; hintsUsed: number }): void {
    const res = this.save.complete(meta.id, r);
    const next = LEVELS[meta.index] ?? null;
    const rep = this.reports.get(meta.id)!;
    if (res.unlockedNext) this.audio.play('unlock');
    setTimeout(() => {
      if (!this.level || this.level.meta.id !== meta.id) return;
      this.ui.hideHud();
      this.ui.showWin({
        levelName: meta.name,
        moves: r.moves,
        costText: this.formatCost(meta, r.cost),
        optimalText: rep.optimal ? `Optimal: ${this.formatCost(meta, rep.optimal.cost)}` : '',
        stars: r.stars,
        improved: res.improved,
        hasNext: !!next,
        unlockedName: res.unlockedNext ? levelById(res.unlockedNext)!.name : null,
        noHints: r.hintsUsed === 0,
      });
    }, 1900);
  }

  // ───────────────────────── callbacks ─────────────────────────

  private callbacks() {
    return {
      onSail: () => void this.level?.sail(),
      onUndo: () => {
        this.ui.hideFail();
        this.level?.undo();
      },
      onReset: () => this.level?.reset(),
      onHint: () => this.level?.hint(false),
      onHintMore: () => this.level?.hint(true),
      onHintClose: () => this.level?.closeHint(),
      onPause: () => {
        if (!this.level) return;
        this.input.enabled = false;
        this.ui.showPause(this.level.meta.name);
      },
      onResume: () => {
        this.ui.hidePause();
        this.input.enabled = true;
      },
      onRestart: () => {
        this.ui.hidePause();
        this.ui.hideFail();
        this.ui.hideWin();
        this.input.enabled = true;
        if (this.level) {
          this.level.reset();
          this.ui.showHud(this.level.hudState());
        }
      },
      onToMap: () => {
        this.ui.hidePause();
        this.input.enabled = true;
        void this.showMapScreen();
      },
      onOpenSettings: () => this.ui.showSettings(this.save.settings),
      onCloseSettings: () => this.ui.hideSettings(),
      onSettingsChange: (patch: Partial<Settings>) => this.applySettings(patch),
      onStartLevel: (id: string) => void this.startLevel(id),
      onNextLevel: () => {
        const cur = this.level?.meta;
        const next = cur ? LEVELS[cur.index] : undefined;
        if (next) void this.startLevel(next.id);
        else void this.showMapScreen();
      },
      onReplay: () => {
        this.ui.hideWin();
        if (this.level) {
          this.level.reset();
          this.ui.showHud(this.level.hudState());
        }
      },
      onSkipIntro: () => {
        this.rig.skipCinematic();
        this.ui.setIntroSkip(false);
      },
      onUnboard: (id: string) => this.level?.toggleEntity(id),
      onUiSound: (kind: 'hover' | 'click') => this.audio.play(kind === 'hover' ? 'hover' : 'ui'),
    };
  }

  private applySettings(patch: Partial<Settings>): void {
    const before = this.save.settings;
    const qualityChanged = patch.quality !== undefined && patch.quality !== before.quality;
    this.save.updateSettings({ ...patch, ...(qualityChanged ? { qualityAuto: false } : {}) });
    const s = this.save.settings;
    this.audio.setVolumes({ music: s.musicVolume, sfx: s.sfxVolume, ambience: s.ambienceVolume, muted: s.muted || this.cfg.mute });
    this.rig.reducedMotion = s.reducedMotion;
    if (qualityChanged) this.applyQuality(s.quality);
  }

  private applyQuality(q: QualityLevel): void {
    this.renderer.setQuality(q);
    if (this.level) this.post.configure(this.level.world.scene, this.rig.camera, this.renderer.preset, this.level.world.look);
    else if (this.map) this.post.configure(this.map.scene, this.rig.camera, this.renderer.preset, this.map.look);
  }

  private keys = new Set<string>();

  private keyboardCamera(dt: number): void {
    const k = this.keys;
    if (!k.size || this.ui.isModalOpen) return;
    const on = (...codes: string[]) => (codes.some((c) => k.has(c)) ? 1 : 0);
    const x = on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft');
    const z = on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown');
    const rot = on('KeyE') - on('KeyQ');
    const zoom = on('KeyF', 'PageDown', 'Minus', 'NumpadSubtract') - on('KeyR', 'PageUp', 'Equal', 'NumpadAdd', 'BracketRight');
    const tilt = on('KeyG') - on('KeyT');
    this.rig.keyMove(dt, x, z, rot, zoom, tilt);
  }

  private installKeyboard(): void {
    const camKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyT', 'KeyG', 'PageUp', 'PageDown', 'Minus', 'Equal', 'NumpadAdd', 'NumpadSubtract', 'BracketRight'];
    window.addEventListener('keydown', (e) => {
      if (camKeys.includes(e.code) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
        this.keys.add(e.code);
        if (e.code.startsWith('Arrow') || e.code.startsWith('Page')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const lvl = this.level;
      switch (e.key) {
        case 'Escape':
          if (this.rig.inCinematic) this.rig.skipCinematic();
          else if (lvl && this.screen === 'level') {
            if (this.ui.isModalOpen) {
              this.ui.hidePause();
              this.ui.hideSettings();
              this.input.enabled = true;
            } else this.callbacks().onPause();
          }
          break;
        case ' ':
        case 'Enter':
          if (lvl && !this.ui.isModalOpen && this.screen === 'level') {
            e.preventDefault();
            void lvl.sail();
          }
          break;
        case 'z':
        case 'Z':
        case 'Backspace':
          if (lvl && !this.ui.isModalOpen) lvl.undo();
          break;
        case 'h':
        case 'H':
          if (lvl && !this.ui.isModalOpen) lvl.hint(this.level!.session.hintStage > 0);
          break;
        case 'c':
        case 'C':
          this.rig.resetView();
          break;
      }
    });
  }

  // ───────────────────────── frame loop ─────────────────────────

  private frame(): void {
    const now = performance.now();
    const dtMs = Math.min(250, now - this.clock);
    this.clock = now;
    // in QA mode (software rendering, very low fps) the simulation keeps pace with wall-clock time
    const dt = Math.min(this.cfg.qa ? 0.5 : 0.1, dtMs / 1000);
    this.elapsed += dt;
    this.fps = this.fps * 0.93 + (1000 / Math.max(1, dtMs)) * 0.07;
    this.input.update();
    this.keyboardCamera(dt);
    if (this.screen === 'map' && this.map) this.map.update(dt, this.elapsed, this.rig.camera);
    if ((this.screen === 'level' || this.screen === 'loading') && this.level) this.level.update(dt, this.elapsed, this.rig.camera);
    this.rig.update(dt);
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt * 1.4);
      this.post.flash.value = this.flashT * 0.35;
    }
    if (this.screen !== 'boot') this.post.render();
    this.audio.update(dt);
    this.renderer.sampleFrame(dtMs, now);
    this.autoBenchmark(dtMs);
    if (this.cfg.debug) {
      this.debugTimer -= dt;
      if (this.debugTimer <= 0) {
        this.debugTimer = 0.5;
        const i = this.renderer.info;
        this.ui.showDebug(`${this.fps.toFixed(0)} FPS · ${this.renderer.backend.toUpperCase()} · ${this.renderer.preset.label} · DPR ${this.renderer.pixelRatio.toFixed(2)}\n${i.drawCalls} Draw Calls · ${(i.triangles / 1000).toFixed(0)}k Dreiecke · ${i.geometries} Geo · ${i.textures} Tex`);
      }
    }
  }

  /** First-run benchmark: if the automatically chosen quality is far too slow, step down once. */
  private autoBenchmark(dtMs: number): void {
    if (this.benchDone || this.cfg.quality || !this.save.settings.qualityAuto) return;
    if (this.screen !== 'map' && this.screen !== 'level') return;
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length < 150) return;
    this.benchDone = true;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    if (median > 34 && this.save.settings.quality !== 'low') {
      const q = lowerQuality(this.save.settings.quality);
      this.save.updateSettings({ quality: q, qualityAuto: true });
      this.applyQuality(q);
      this.ui.toast('info', 'Grafik angepasst', `Für flüssiges Spiel wurde die Qualität auf „${QUALITY_PRESETS[q].label}“ gesetzt. Änderbar in den Einstellungen.`);
    }
  }

  // ───────────────────────── QA API (docs/QA-CONTRACT.md) ─────────────────────────

  private installQa(): void {
    const proj = (p: THREE.Vector3) => this.rig.project(p, this.renderer.width, this.renderer.height);
    const api = {
      version: 1 as const,
      isReady: () => (this.screen === 'map' || this.screen === 'level') && !this.busyLoading,
      screen: () => this.screen,
      rendererInfo: () => ({ backend: this.renderer.backend, quality: this.renderer.preset.level, fps: Math.round(this.fps), ...this.renderer.info }),
      levels: () =>
        LEVELS.map((l) => {
          const r = this.save.record(l.id);
          const rep = this.reports.get(l.id)!;
          return {
            id: l.id,
            name: l.name,
            unlocked: this.save.isUnlocked(l.id),
            completed: r.completed,
            valid: rep.ok,
            optimalCost: rep.optimal?.cost ?? -1,
            metric: rep.metric,
            bestCost: r.bestCost,
          };
        }),
      currentLevel: () => {
        const l = this.level;
        if (!l || this.screen !== 'level') return null;
        const s = l.session;
        return {
          id: l.meta.id,
          moves: s.moves,
          cost: s.elapsed,
          boatSide: s.vehicleSide === 0 ? ('left' as const) : ('right' as const),
          boatLoad: s.loadIds(),
          entities: l.model.ids.map((id) => ({ id, name: l.model.entity(id).name, location: s.location(id) })),
          won: s.won,
          failed: s.failed,
          busy: l.busy,
        };
      },
      entityScreenPos: (id: string) => (this.level && this.level.model.has(id) ? proj(this.level.entityScreenAnchor(id)) : null),
      /** debug: world position of a figure (disappearing / clipping checks) */
      entityWorldPos: (id: string) => {
        const a = this.level?.world.actors.get(id);
        if (!a) return null;
        const p = a.root.getWorldPosition(new THREE.Vector3());
        return { x: p.x, y: p.y, z: p.z, ground: this.level!.world.groundAt(p.x, p.z), inScene: !!a.root.parent };
      },
      boatScreenPos: () => (this.level ? proj(this.level.vehicleAnchor()) : null),
      bankScreenPos: (side: 'left' | 'right') => (this.level ? proj(this.level.bankAnchor(side === 'left' ? 0 : 1)) : null),
      mapNodeScreenPos: (id: string) => (this.map && this.screen === 'map' ? proj(this.map.nodePosition(id)) : null),
      solveFromCurrent: () => {
        const l = this.level;
        if (!l) return null;
        const sol = l.session.solveFromCurrent();
        return sol ? { actions: sol.actions.map((a) => l.model.idsOf(a.group)), cost: sol.cost } : null;
      },
      waitIdle: (timeoutMs = 60000) =>
        new Promise<void>((resolve, reject) => {
          const t0 = performance.now();
          const tick = () => {
            const idle = !this.busyLoading && !this.rig.inCinematic && (this.screen === 'map' || (this.screen === 'level' && !!this.level && !this.level.busy));
            if (idle) resolve();
            else if (performance.now() - t0 > timeoutMs) reject(new Error('waitIdle timeout'));
            else setTimeout(tick, 50);
          };
          tick();
        }),
      unlockAll: () => {
        if (!this.cfg.qa) return;
        this.save.unlockAll();
        this.map?.updateNodes(this.mapNodes());
        if (this.screen === 'map') this.ui.showMap(this.mapCards());
      },
      resetProgress: () => {
        if (!this.cfg.qa) return;
        this.save.resetProgress();
        this.map?.updateNodes(this.mapNodes());
      },
      errors: () => [...this.errors],
    };
    (window as unknown as { __RIVERBOUND_QA__: typeof api }).__RIVERBOUND_QA__ = api;
  }

  /** Called on fatal boot errors so the page never ends in a blank dead end. */
  static renderFatal(root: HTMLElement, err: unknown): void {
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'fatal';
    box.innerHTML = `<h1>Riverbound konnte nicht starten</h1><p>Dein Browser stellt weder WebGPU noch WebGL2 bereit oder ein Fehler ist aufgetreten.</p><pre></pre><button type="button">Neu laden</button>`;
    box.querySelector('pre')!.textContent = String(err instanceof Error ? err.message : err);
    box.querySelector('button')!.addEventListener('click', () => location.reload());
    root.appendChild(box);
  }
}

export type { PickHit };
