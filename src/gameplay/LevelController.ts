import * as THREE from 'three/webgpu';
import type { Actor } from '../characters/Actor';
import type { AudioEngine } from '../audio/AudioEngine';
import type { CameraRig } from '../camera/CameraRig';
import type { PickHit, PointerHandler } from '../input/PointerInput';
import type { LevelMeta } from '../levels/registry';
import { PuzzleModel } from '../puzzle/engine';
import { PuzzleSession } from '../puzzle/session';
import type { Side, Violation } from '../puzzle/types';
import type { HudState, UI } from '../ui/UI';
import type { LevelWorld } from '../world/types';

export interface LevelControllerDeps {
  rig: CameraRig;
  ui: UI;
  audio: AudioEngine;
  reducedMotion: boolean;
  onWin(result: { cost: number; moves: number; stars: number; hintsUsed: number }): void;
  onFlash(): void;
}

interface Tween {
  update(dt: number): boolean;
}

const tmpV = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Binds the pure PuzzleSession to the 3D world: every interaction goes through the session's
 * rule checks first; the world only visualises the accepted state (no scripted solution).
 */
export class LevelController implements PointerHandler {
  readonly session: PuzzleSession;
  readonly model: PuzzleModel;
  private tweens: Tween[] = [];
  private pending = new Set<Promise<void>>();
  private crossing = false;
  private hovered: string | null = null;
  private drag: { id: string; marker: THREE.Mesh } | null = null;
  private alertTimer = 0;
  private alerted: Actor[] = [];
  private focusReturn = 0;
  private displayedCost = 0;
  private hintOpen = false;
  won = false;
  private seatOf = new Map<string, number>();
  private readonly proxies: THREE.Object3D[] = [];

  constructor(
    readonly meta: LevelMeta,
    readonly world: LevelWorld,
    private readonly deps: LevelControllerDeps,
  ) {
    this.model = new PuzzleModel(meta.puzzle);
    this.session = new PuzzleSession(this.model);
    for (const id of this.model.ids) {
      const a = world.actors.get(id);
      if (!a) throw new Error(`Welt ${meta.id}: Figur "${id}" fehlt.`);
      this.proxies.push(a.pickProxy);
      a.groundAt = (x, z) => this.walkGround(x, z);
    }
    this.proxies.push(world.vehicle.pickProxy);
    this.placeAll(true);
    this.refreshHud();
  }

  // ───────────────────────── placement ─────────────────────────

  private actor(id: string): Actor {
    return this.world.actors.get(id)!;
  }

  /**
   * Formation: figures wait in one tidy row along the shoreline (parallel to the water),
   * alternating left/right of the jetty – never scattered.
   */
  private slotFor(id: string, side: Side): THREE.Vector3 {
    const bank = this.world.banks[side];
    const i = this.model.indexOf(id);
    const sign = side === 0 ? -1 : 1;
    const x = sign * this.shoreX(side);
    const offset = (i % 2 === 0 ? 1 : -1) * (1.7 + Math.floor(i / 2) * 1.45);
    return new THREE.Vector3(x, 0, bank.dockPoint.z + offset);
  }

  /** |x| of the waiting line: just on land behind the jetty's shore end. */
  private shoreX(side: Side): number {
    return Math.max(Math.abs(this.world.banks[side].dockPoint.x) + 2.2, 7.0);
  }

  /** Where the jetty meets the land (walk waypoint between the row and the dock point). */
  private jettyLand(side: Side): THREE.Vector3 {
    const dock = this.world.banks[side].dockPoint;
    return new THREE.Vector3((side === 0 ? -1 : 1) * this.shoreX(side), dock.y, dock.z);
  }

  /** Ground sampler that walks on the jetty deck instead of the river bed below it. */
  private walkGround(x: number, z: number): number {
    const g = this.world.groundAt(x, z);
    const side: Side = x < 0 ? 0 : 1;
    const dock = this.world.banks[side].dockPoint;
    const ax = Math.abs(x);
    const onJetty = Math.abs(z - dock.z) < 1.15 && ax >= Math.abs(dock.x) - 0.6 && ax <= this.shoreX(side) + 0.3;
    return onJetty ? Math.max(g, dock.y) : g;
  }

  private freeSeat(id: string): number {
    const sticky = this.meta.puzzle.vehicle.stickyPilots ?? [];
    if (sticky.includes(id)) return 0;
    const used = new Set(this.seatOf.values());
    const start = sticky.length ? 1 : 0;
    for (let i = start; i < this.world.vehicle.seats.length; i++) if (!used.has(i)) return i;
    return this.world.vehicle.seats.length - 1;
  }

  private riderMood(): 'sit' | 'ride' {
    return this.world.seated ? 'sit' : 'ride';
  }

  /** Snaps vehicle and every actor to the session state (used on start/reset). */
  private placeAll(initial = false): void {
    const v = this.world.vehicle;
    const side = this.session.vehicleSide;
    v.root.position.copy(v.docks[side]);
    v.root.rotation.y = v.yaw[side];
    v.root.updateMatrixWorld(true);
    this.seatOf.clear();
    for (const id of this.model.ids) {
      const a = this.actor(id);
      const loc = this.session.location(id);
      if (loc === 'boat') {
        const seat = this.freeSeat(id);
        this.seatOf.set(id, seat);
        v.seats[seat]!.add(a.root);
        a.root.position.set(0, 0, 0);
        a.root.rotation.set(0, 0, 0);
        a.yawGoal = 0;
        a.mood = this.riderMood();
      } else {
        const s: Side = loc === 'left' ? 0 : 1;
        this.world.scene.add(a.root);
        const p = this.slotFor(id, s);
        a.root.position.set(p.x, a.groundAt(p.x, p.z), p.z);
        a.faceTowards(this.world.banks[s].facing);
        a.snapYaw();
        a.mood = 'idle';
      }
      if (!initial) a.flash();
    }
    this.updateIndicator();
  }

  private updateIndicator(): void {
    const s = this.session;
    const lim = s.limit;
    this.world.vehicle.setIndicator?.({
      count: s.loadCount(),
      capacity: this.meta.puzzle.vehicle.capacity,
      weight: this.meta.puzzle.vehicle.maxWeight !== undefined ? s.loadWeight() : undefined,
      maxWeight: this.meta.puzzle.vehicle.maxWeight,
      energy: lim !== null ? lim - this.displayedCost : undefined,
      maxEnergy: lim ?? undefined,
    });
  }

  // ───────────────────────── HUD ─────────────────────────

  hudState(): HudState {
    const s = this.session;
    const p = this.meta.puzzle;
    const opt = s.optimal;
    const unit = p.cost.type === 'slowest' ? p.cost.unit : 'Überfahrten';
    const busy = this.crossing || this.pending.size > 0;
    const dep = s.checkDeparture();
    const optimalText = opt
      ? p.cost.type === 'slowest'
        ? `Bestmöglich: ${opt.cost} ${unit} · Limit ${p.cost.limit} ${unit}`
        : `Bestmöglich: ${opt.cost} Überfahrten`
      : '—';
    return {
      levelName: this.meta.name,
      subtitle: this.meta.subtitle,
      goal: this.meta.goal,
      rules: this.ruleLines(),
      moves: s.moves,
      optimalText,
      metric: p.cost.type === 'slowest' ? 'time' : 'crossings',
      cost: p.cost.type === 'slowest' ? Math.round(this.displayedCost) : s.moves,
      limit: s.limit,
      unit,
      vehicleName: p.vehicleNames.name,
      capacity: p.vehicle.capacity,
      load: s.loadIds().map((id) => ({ id, name: this.model.entity(id).name })),
      weight: p.vehicle.maxWeight !== undefined ? { current: s.loadWeight(), max: p.vehicle.maxWeight } : null,
      destination: p.sides[(1 - s.vehicleSide) as Side].to,
      canSail: dep.ok && !busy && !s.won,
      busy,
      undoAvailable: s.history.length > 0 && !busy,
    };
  }

  private ruleLines(): string[] {
    const p = this.meta.puzzle;
    const lines = p.rules.map((r) => r.summary);
    const cap = p.vehicle.capacity;
    const pilots = this.model.entities.filter((e) => e.canPilot).map((e) => e.name);
    lines.push(`${p.vehicleNames.name}: höchstens ${cap} ${cap === 1 ? 'Figur' : 'Figuren'} an Bord${p.vehicle.maxWeight ? `, maximal ${p.vehicle.maxWeight} kg` : ''}.`);
    lines.push(pilots.length === this.model.n ? 'Alle können steuern – leer fährt nichts.' : `Steuern ${pilots.length > 1 ? 'können' : 'kann'} nur: ${pilots.join(', ')}.`);
    if (p.cost.type === 'slowest') lines.push(`Eine Fahrt dauert so lange wie die langsamste Person an Bord. Energie: ${p.cost.limit} ${p.cost.unit}.`);
    return lines;
  }

  refreshHud(): void {
    this.deps.ui.updateHud(this.hudState());
    this.updateIndicator();
  }

  // ───────────────────────── tweens ─────────────────────────

  private track(p: Promise<void>): Promise<void> {
    this.pending.add(p);
    void p.finally(() => {
      this.pending.delete(p);
      this.refreshHud();
    });
    return p;
  }

  private tween(dur: number, fn: (u: number, dt: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      this.tweens.push({
        update: (dt) => {
          t += dt;
          const u = Math.min(1, t / dur);
          fn(u, dt);
          if (u >= 1) resolve();
          return u >= 1;
        },
      });
    });
  }

  // ───────────────────────── actions ─────────────────────────

  get busy(): boolean {
    return this.crossing || this.pending.size > 0;
  }

  toggleEntity(id: string): void {
    if (this.crossing || this.won) return;
    const a = this.actor(id);
    if (a.isBusy) return;
    const wasAboard = this.session.isAboard(id);
    const r = wasAboard ? this.session.unboard(id) : this.session.board(id);
    if (!r.ok) {
      this.rejected(r.violation ? [r.violation] : []);
      return;
    }
    this.deps.audio.play(wasAboard ? 'unboard' : 'board', { world: this.meta.id, pan: this.panOf(a) });
    if (wasAboard) void this.track(this.animateUnboard(id, this.session.vehicleSide));
    else void this.track(this.animateBoard(id));
    this.refreshHud();
  }

  private async animateBoard(id: string): Promise<void> {
    const a = this.actor(id);
    const v = this.world.vehicle;
    const side = this.session.vehicleSide;
    const seatIdx = this.freeSeat(id);
    this.seatOf.set(id, seatIdx);
    const seat = v.seats[seatIdx]!;
    a.react('select');
    const loc = a.root.getWorldPosition(new THREE.Vector3());
    const land = this.jettyLand(side);
    const route = Math.abs(loc.z - land.z) > 0.4 ? [land, this.world.banks[side].dockPoint] : [this.world.banks[side].dockPoint];
    await a.walkTo(route);
    const target = seat.getWorldPosition(new THREE.Vector3());
    await a.hopTo(target, 0.7, 0.55, 'world');
    seat.attach(a.root);
    a.root.position.set(0, 0, 0);
    a.root.rotation.set(0, a.root.rotation.y, 0);
    a.yawGoal = 0;
    a.mood = this.riderMood();
    this.deps.audio.play('tick', { world: this.meta.id });
  }

  private async animateUnboard(id: string, side: Side): Promise<void> {
    const a = this.actor(id);
    this.seatOf.delete(id);
    this.world.scene.attach(a.root);
    a.mood = 'idle';
    const dock = this.world.banks[side].dockPoint;
    await a.hopTo(new THREE.Vector3(dock.x, Math.max(a.groundAt(dock.x, dock.z), dock.y), dock.z), 0.7, 0.55, 'world');
    const slot = this.slotFor(id, side);
    await a.walkTo([this.jettyLand(side), slot]);
    a.faceTowards(this.world.banks[side].facing);
  }

  async sail(): Promise<void> {
    if (this.crossing || this.won) return;
    if (this.pending.size) await Promise.all([...this.pending]);
    const check = this.session.checkDeparture();
    if (!check.ok) {
      this.rejected(check.violations, true);
      return;
    }
    const riders = this.session.loadIds();
    const from = this.session.vehicleSide;
    const res = this.session.sail();
    if (!res.ok) return;
    this.deps.ui.hideHint();
    this.hintOpen = false;
    await this.animateCrossing(from, res.to, riders, res.cost);
    this.afterArrival(res.to, riders);
  }

  private async animateCrossing(from: Side, to: Side, riders: string[], cost: number): Promise<void> {
    this.crossing = true;
    this.refreshHud();
    const v = this.world.vehicle;
    const startCost = this.displayedCost;
    const endCost = this.meta.puzzle.cost.type === 'slowest' ? this.session.elapsed : 0;
    this.world.onCrossingStart?.(to);
    this.deps.audio.play('depart', { world: this.meta.id });
    for (const id of riders) {
      const a = this.actor(id);
      a.mood = this.riderMood();
      a.lookTarget = null;
    }
    const pathPts = v.path && v.path.length >= 2 ? (to === 1 ? v.path : [...v.path].reverse()) : [v.docks[from], v.docks[to]];
    const curve = new THREE.CatmullRomCurve3(pathPts.map((p) => p.clone()));
    const yaw0 = v.yaw[from];
    let dyaw = v.yaw[to] - yaw0;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dur = v.crossingTime * (1 + riders.length * 0.06) * (this.meta.puzzle.cost.type === 'slowest' ? 0.7 + cost * 0.06 : 1);
    // gentle camera follow
    const mid = v.docks[0].clone().lerp(v.docks[1], 0.5);
    this.deps.rig.focus(mid.clone().setY(this.deps.rig.homeView.target.y));
    await this.tween(dur, (u, dt) => {
      const e = easeInOutCubic(u);
      curve.getPoint(e, v.root.position);
      v.root.position.y += Math.sin(u * Math.PI) * 0.05;
      v.root.rotation.y = yaw0 + dyaw * easeInOutCubic(Math.min(1, u * 1.15));
      v.root.rotation.z = Math.sin(u * Math.PI * 3) * 0.02 * (1 - u);
      v.update(dt, performance.now() / 1000, Math.sin(u * Math.PI));
      if (this.meta.puzzle.cost.type === 'slowest') {
        this.displayedCost = startCost + (endCost - startCost) * e;
        this.deps.ui.updateHud(this.hudState());
        this.updateIndicator();
      }
    });
    v.root.position.copy(v.docks[to]);
    v.root.rotation.set(0, v.yaw[to], 0);
    this.displayedCost = this.meta.puzzle.cost.type === 'slowest' ? endCost : 0;
    this.deps.audio.play('arrive', { world: this.meta.id });
    this.world.onCrossingEnd?.(to);
    this.crossing = false;
  }

  private afterArrival(side: Side, riders: string[]): void {
    const sticky = this.meta.puzzle.vehicle.stickyPilots ?? [];
    const walks: Promise<void>[] = [];
    let delay = 0;
    for (const id of riders) {
      if (sticky.includes(id)) continue;
      const d = delay;
      delay += 0.25;
      walks.push(this.wait(d).then(() => this.animateUnboard(id, side)));
    }
    this.deps.audio.play('valid', { world: this.meta.id });
    const all = Promise.all(walks).then(() => undefined);
    void this.track(all);
    this.refreshHud();
    void all.then(() => {
      if (this.session.won) this.win();
      else if (this.session.failed) {
        this.deps.audio.play('invalid', { world: this.meta.id });
        this.deps.ui.showFail('Energie erschöpft', 'Mit der verbleibenden Energie kann keine erlaubte Fahrt mehr starten. Nimm Züge zurück oder starte neu.');
      }
      this.deps.rig.resetView();
    });
  }

  private wait(s: number): Promise<void> {
    return this.tween(Math.max(0.001, s), () => {});
  }

  undo(): void {
    if (this.busy || this.won) return;
    const last = this.session.history[this.session.history.length - 1];
    if (!last) return;
    this.deps.ui.hideFail();
    const group = this.model.idsOf(last.group);
    this.deps.audio.play('undo', { world: this.meta.id });
    const run = async () => {
      // the group walks back aboard, the vehicle returns, they stay aboard (state before sailing)
      const sticky = this.meta.puzzle.vehicle.stickyPilots ?? [];
      const boarding = group.filter((id) => !sticky.includes(id)).map((id) => this.animateBoard(id));
      await Promise.all(boarding);
      const e = this.session.undo()!;
      this.crossing = true;
      const v = this.world.vehicle;
      const startCost = this.displayedCost;
      await this.tween(v.crossingTime * 0.6, (u, dt) => {
        const k = easeInOutCubic(u);
        v.root.position.lerpVectors(v.docks[e.to], v.docks[e.from], k);
        v.root.rotation.y = THREE.MathUtils.lerp(v.yaw[e.to], v.yaw[e.from], k);
        v.update(dt, performance.now() / 1000, Math.sin(u * Math.PI));
        if (this.meta.puzzle.cost.type === 'slowest') this.displayedCost = startCost + (this.session.elapsed - startCost) * k;
      });
      v.root.position.copy(v.docks[e.from]);
      v.root.rotation.set(0, v.yaw[e.from], 0);
      this.displayedCost = this.meta.puzzle.cost.type === 'slowest' ? this.session.elapsed : 0;
      this.crossing = false;
    };
    void this.track(run());
  }

  reset(): void {
    if (this.busy) return;
    this.deps.ui.hideFail();
    this.deps.ui.hideHint();
    this.hintOpen = false;
    this.session.reset();
    this.displayedCost = 0;
    this.won = false;
    this.deps.audio.play('reset', { world: this.meta.id });
    this.placeAll();
    this.deps.rig.resetView();
    this.refreshHud();
  }

  hint(more = false): void {
    if (this.won) return;
    const h = more ? this.session.nextHint() : this.session.hintStage === 0 ? this.session.hint(1) : this.session.hint(this.session.hintStage as 1 | 2 | 3);
    this.hintOpen = true;
    this.deps.audio.play('hint', { world: this.meta.id });
    this.deps.ui.showHint(h.level, h.title, h.text, h.level < 3 && !h.doomed);
    for (const id of this.model.ids) this.actor(id).setHighlight(h.focus.includes(id) ? 2 : 0);
    if (h.focus.length) {
      const c = this.actor(h.focus[0]!).getCenter(tmpV);
      this.deps.rig.focus(c.clone().setY(this.deps.rig.homeView.target.y));
      this.focusReturn = 3.5;
    }
  }

  closeHint(): void {
    this.hintOpen = false;
    this.deps.ui.hideHint();
    for (const id of this.model.ids) this.actor(id).setHighlight(id === this.hovered ? 1 : 0);
  }

  /** Invalid action feedback: explanation, involved figures glow & react, camera shows the conflict. */
  private rejected(violations: Violation[], departure = false): void {
    const v = violations[0];
    this.deps.audio.play('invalid', { world: this.meta.id });
    if (!v) return;
    const extra = violations.length > 1 ? ` (+${violations.length - 1} weitere Regel${violations.length > 2 ? 'n' : ''} verletzt)` : '';
    this.deps.ui.toast('invalid', v.title, v.message + extra, 5200);
    this.clearAlerts();
    const involved = [...new Set(violations.flatMap((x) => x.entities))].filter((id) => this.model.has(id));
    involved.forEach((id, i) => {
      const a = this.actor(id);
      a.setAlert(true);
      const rule = v.kind === 'rule';
      a.react(rule ? (i === 0 ? 'threat' : 'fear') : 'fail');
      this.alerted.push(a);
    });
    this.alertTimer = 3.2;
    this.deps.rig.shake(0.18);
    this.world.onViolation?.();
    if (departure && v.location !== undefined && v.location !== 'vehicle' && involved.length) {
      const c = new THREE.Vector3();
      for (const id of involved) c.add(this.actor(id).getCenter(tmpV));
      c.divideScalar(involved.length);
      this.deps.rig.focus(c.setY(this.deps.rig.homeView.target.y), Math.max(12, this.deps.rig.homeView.radius * 0.7));
      this.focusReturn = 3.2;
    }
  }

  private clearAlerts(): void {
    for (const a of this.alerted) a.setAlert(false);
    this.alerted = [];
  }

  private win(): void {
    if (this.won) return;
    this.won = true;
    const s = this.session;
    for (const id of this.model.ids) {
      const a = this.actor(id);
      a.react('celebrate', 3.2);
      a.flash();
    }
    this.deps.audio.play('levelComplete', { world: this.meta.id });
    this.deps.onFlash();
    this.world.onWin?.();
    const side = this.world.banks[1];
    const c = side.slots[0]!.clone().lerp(side.slots[Math.min(side.slots.length - 1, 3)]!, 0.5);
    this.deps.rig.startShowcase(c.setY(c.y + 1), 14, 1.05, 0.18);
    this.deps.onWin({ cost: s.elapsed, moves: s.moves, stars: s.rating(), hintsUsed: s.hintsUsed });
  }

  private panOf(a: Actor): number {
    const p = a.root.getWorldPosition(tmpV);
    return THREE.MathUtils.clamp(p.x / 12, -0.8, 0.8);
  }

  // ───────────────────────── per frame ─────────────────────────

  update(dt: number, t: number, camera: THREE.PerspectiveCamera): void {
    this.tweens = this.tweens.filter((tw) => !tw.update(dt));
    for (const id of this.model.ids) this.actor(id).update(dt);
    if (!this.crossing) this.world.vehicle.update(dt, t, 0);
    this.world.update(dt, t, camera);
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) this.clearAlerts();
    }
    if (this.focusReturn > 0) {
      this.focusReturn -= dt;
      if (this.focusReturn <= 0 && !this.won) this.deps.rig.resetView();
    }
  }

  // ───────────────────────── pointer handler ─────────────────────────

  private camera(): THREE.PerspectiveCamera {
    return this.deps.rig.camera;
  }

  pick(x: number, y: number): PickHit | null {
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, this.camera());
    const hits = raycaster.intersectObjects(this.proxies, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        const pick = o.userData.pick as PickHit | undefined;
        if (pick) return { ...pick, point: { x: h.point.x, y: h.point.y, z: h.point.z } };
        o = o.parent;
      }
    }
    return null;
  }

  onHover(hit: PickHit | null, cx: number, cy: number): void {
    const id = hit?.kind === 'entity' ? hit.id : hit?.kind === 'vehicle' ? '__vehicle' : null;
    if (id !== this.hovered) {
      if (this.hovered && this.hovered !== '__vehicle' && !this.hintOpen) this.actor(this.hovered).setHighlight(0);
      this.hovered = id;
      if (id && id !== '__vehicle') {
        this.actor(id).setHighlight(1);
        this.deps.audio.play('hover', { world: this.meta.id });
      }
      document.body.style.cursor = id ? 'pointer' : '';
    }
    if (!hit) {
      this.deps.ui.hideTooltip();
      return;
    }
    if (hit.kind === 'entity') {
      const e = this.model.entity(hit.id);
      const loc = this.session.location(hit.id);
      const locText = loc === 'boat' ? this.meta.puzzle.vehicleNames.at : this.meta.puzzle.sides[loc === 'left' ? 0 : 1].at;
      const action = this.session.isSticky(hit.id)
        ? 'Steuert – bleibt an Bord'
        : loc === 'boat'
          ? 'Klicken: aussteigen'
          : (loc === 'left' ? 0 : 1) === this.session.vehicleSide
            ? `Klicken oder ziehen: ${this.meta.puzzle.vehicleNames.into}`
            : 'Steht am anderen Ufer';
      const lines = [e.trait, `Ort: ${locText}`, action];
      if (e.flavor) lines.push(e.flavor);
      this.deps.ui.showTooltip(cx, cy, e.name, lines);
    } else if (hit.kind === 'vehicle') {
      const s = this.session;
      const p = this.meta.puzzle;
      const load = s.loadIds().map((i) => this.model.entity(i).name);
      const lines = [
        `An Bord: ${load.length ? load.join(', ') : 'niemand'} (${s.loadCount()}/${p.vehicle.capacity})`,
        p.vehicle.maxWeight !== undefined ? `Gewicht: ${s.loadWeight()} / ${p.vehicle.maxWeight} kg` : '',
        p.cost.type === 'slowest' && s.loadCount() ? `Fahrtdauer: ${s.loadCost()} ${p.cost.unit}` : '',
        `Klicken: ablegen ${p.sides[(1 - s.vehicleSide) as Side].to}`,
      ].filter(Boolean);
      this.deps.ui.showTooltip(cx, cy, p.vehicleNames.name, lines);
    }
  }

  onClick(hit: PickHit | null, button: number): void {
    if (button !== 0) return;
    if (!hit) return;
    this.deps.ui.hideTooltip();
    if (hit.kind === 'entity') this.toggleEntity(hit.id);
    else if (hit.kind === 'vehicle') void this.sail();
  }

  canDrag(hit: PickHit): boolean {
    if (hit.kind !== 'entity' || this.crossing || this.won) return false;
    if (this.session.isSticky(hit.id)) return false;
    return !this.actor(hit.id).isBusy;
  }

  onDragStart(hit: PickHit): void {
    const geo = new THREE.RingGeometry(0.35, 0.5, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(1.6, 1.3, 0.6), transparent: true, opacity: 0.85, depthWrite: false });
    const marker = new THREE.Mesh(geo, mat);
    marker.renderOrder = 10;
    this.world.scene.add(marker);
    this.drag = { id: hit.id, marker };
    this.actor(hit.id).setHighlight(2);
    this.deps.ui.hideTooltip();
  }

  onDragMove(_cx: number, _cy: number, nx: number, ny: number): void {
    if (!this.drag) return;
    ndc.set(nx, ny);
    raycaster.setFromCamera(ndc, this.camera());
    const p = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, p)) {
      this.drag.marker.position.set(p.x, this.actor(this.drag.id).groundAt(p.x, p.z) + 0.06, p.z);
    }
  }

  onDragEnd(_cx: number, _cy: number, nx: number, ny: number): void {
    const d = this.drag;
    if (!d) return;
    this.onDragCancel();
    const hit = this.pick(nx, ny);
    ndc.set(nx, ny);
    raycaster.setFromCamera(ndc, this.camera());
    const p = new THREE.Vector3();
    const onPlane = raycaster.ray.intersectPlane(groundPlane, p);
    const vpos = this.world.vehicle.root.getWorldPosition(tmpV);
    const nearVehicle = hit?.kind === 'vehicle' || (onPlane && p.distanceTo(vpos) < 2.8);
    const aboard = this.session.isAboard(d.id);
    if (nearVehicle && !aboard) this.toggleEntity(d.id);
    else if (!nearVehicle && aboard && onPlane) this.toggleEntity(d.id);
    this.actor(d.id).setHighlight(this.hovered === d.id ? 1 : 0);
  }

  onDragCancel(): void {
    if (!this.drag) return;
    this.drag.marker.removeFromParent();
    this.drag.marker.geometry.dispose();
    (this.drag.marker.material as THREE.Material).dispose();
    this.actor(this.drag.id).setHighlight(0);
    this.drag = null;
  }

  rotateCamera(dx: number, dy: number): void {
    this.deps.rig.rotate(dx, dy);
    this.focusReturn = 0;
  }
  panCamera(dx: number, dy: number): void {
    this.deps.rig.pan(dx, dy);
    this.focusReturn = 0;
  }
  zoomCamera(d: number): void {
    this.deps.rig.zoom(d);
    this.focusReturn = 0;
  }

  // ───────────────────────── QA helpers ─────────────────────────

  entityScreenAnchor(id: string): THREE.Vector3 {
    return this.actor(id).getCenter(new THREE.Vector3());
  }

  vehicleAnchor(): THREE.Vector3 {
    return this.world.vehicle.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0));
  }

  bankAnchor(side: Side): THREE.Vector3 {
    const s = this.world.banks[side].slots;
    return s[s.length - 1]!.clone();
  }

  dispose(): void {
    this.onDragCancel();
    this.tweens = [];
    document.body.style.cursor = '';
    this.world.dispose();
  }
}
