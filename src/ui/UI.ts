/**
 * Riverbound – DOM/CSS UI layer (plain DOM, no framework).
 * All visible text is German. Every panel is a `Layer` that is attached lazily and animated via CSS classes.
 */
import './ui.css';
import type { Settings } from '../save/SaveStore';
import { QUALITY_ORDER, QUALITY_PRESETS } from '../render/quality';
import type { QualityLevel } from '../render/quality';
import { icon, logoMark, wavesSvg } from './icons';
import type { IconName } from './icons';

export type ThemeId = 'map' | 'forest' | 'temple' | 'neon' | 'harbor' | 'ice';

export interface MapCardInfo {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  description: string;
  mechanic: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  unlocked: boolean;
  completed: boolean;
  stars: number;
  best: string | null;
  optimal: string;
  valid: boolean;
}

export interface HudState {
  levelName: string;
  subtitle: string;
  goal: string;
  rules: string[];
  moves: number;
  optimalText: string;
  metric: 'crossings' | 'time';
  cost: number;
  limit: number | null;
  unit: string;
  vehicleName: string;
  capacity: number;
  load: Array<{ id: string; name: string }>;
  weight: { current: number; max: number } | null;
  destination: string;
  canSail: boolean;
  busy: boolean;
  undoAvailable: boolean;
}

export interface UICallbacks {
  onSail(): void;
  onUndo(): void;
  onReset(): void;
  onHint(): void;
  onHintMore(): void;
  onHintClose(): void;
  onPause(): void;
  onResume(): void;
  onRestart(): void;
  onToMap(): void;
  onOpenSettings(): void;
  onCloseSettings(): void;
  onSettingsChange(patch: Partial<Settings>): void;
  onStartLevel(id: string): void;
  onNextLevel(): void;
  onReplay(): void;
  onSkipIntro(): void;
  onUnboard(id: string): void;
  onUiSound(kind: 'hover' | 'click'): void;
}

export interface WinInfo {
  levelName: string;
  moves: number;
  costText: string;
  optimalText: string;
  stars: number;
  improved: boolean;
  hasNext: boolean;
  unlockedName: string | null;
  noHints: boolean;
}

/* ------------------------------------------------------------------ helpers */

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

const THEME_ORDER: readonly string[] = ['forest', 'temple', 'neon', 'harbor', 'ice'];
const DIFFICULTY_WORDS = ['Sehr leicht', 'Leicht', 'Mittel', 'Schwer', 'Sehr schwer'];
const QUALITY_HELP: Record<QualityLevel, string> = {
  low: 'Schlanke Effekte – ideal für schwächere Geräte.',
  medium: 'Ausgewogen: Bloom, weiche Schatten, Wasserfarben.',
  high: 'Volle Effekte mit Ambient Occlusion und Wasserbrechung.',
  ultra: 'Maximale Details, Godrays und Tiefenunschärfe – viel GPU-Leistung.',
};
const FONT_LOADS = [
  '400 16px "RB Inter"',
  '600 16px "RB Inter"',
  '600 32px "RB Cinzel"',
  '600 24px "RB Fraunces"',
  '600 24px "RB Orbitron"',
  '600 24px "RB Cormorant"',
  '600 24px "RB Exo2"',
];
/** Cache-key sentinel that never equals a real key (forces the next render to rebuild). */
const STALE = '\u0000stale';
const FOCUSABLE =
  'button:not(:disabled):not([hidden]), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') node.className = String(v);
      else if (k === 'html') node.innerHTML = String(v);
      else if (k === 'testid') node.setAttribute('data-testid', String(v));
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

/** Icon wrapped in a decorative span. */
function ic(name: IconName, cls = ''): HTMLSpanElement {
  return h('span', { class: `rb-ic ${cls}`.trim(), 'aria-hidden': 'true', html: icon(name) });
}

function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function reflow(node: HTMLElement): void {
  void node.offsetWidth;
}

function ruleIcon(text: string): IconName {
  const t = text.toLowerCase();
  if (/kg|gewicht/.test(t)) return 'scale';
  if (/\bmin\b|minute|zeit|dauer|langsam|schnell|tempo/.test(t)) return 'clock';
  if (/allein|\bnie\b|niemals|nicht|frisst|fressen|kein|darf|gefahr|streit/.test(t)) return 'alert';
  if (/boot|floß|floss|fähre|kahn|ruder|schiff|plätze|platz|passen|kapazität/.test(t)) return 'boat';
  if (/begleit|zusammen|paar|gruppe|familie/.test(t)) return 'users';
  return 'dot';
}

/** A panel that is attached on demand and animated through `.is-in` / `.is-out`. */
class Layer {
  private timer = 0;
  private on = false;

  constructor(
    readonly el: HTMLElement,
    private readonly host: HTMLElement,
    private readonly exitMs = 280,
  ) {
    el.classList.add('rb-layer');
  }

  get open(): boolean {
    return this.on;
  }

  show(): void {
    if (this.on && this.el.isConnected) return;
    window.clearTimeout(this.timer);
    this.on = true;
    if (!this.el.isConnected) this.host.appendChild(this.el);
    this.el.classList.remove('is-out');
    reflow(this.el);
    this.el.classList.add('is-in');
  }

  hide(): void {
    if (!this.on) return;
    this.on = false;
    this.el.classList.remove('is-in');
    this.el.classList.add('is-out');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.remove();
      this.el.classList.remove('is-out');
    }, this.exitMs);
  }
}

/* ------------------------------------------------------------------ UI */

export class UI {
  private readonly el: HTMLElement;
  private readonly cb: UICallbacks;
  private theme: ThemeId = 'map';
  private cards: MapCardInfo[] = [];
  private selected: MapCardInfo | null = null;
  private modalOrder: Array<{ layer: Layer; prev: HTMLElement | null }> = [];

  /* layers */
  private boot!: Layer;
  private loading!: Layer;
  private map!: Layer;
  private mapCardLayer!: Layer;
  private hud!: Layer;
  private hintLayer!: Layer;
  private pause!: Layer;
  private settings!: Layer;
  private win!: Layer;
  private fail!: Layer;
  private skip!: Layer;

  /* boot / loading */
  private bootBar!: HTMLElement;
  private bootProg!: HTMLElement;
  private bootText!: HTMLElement;
  private loadTitle!: HTMLElement;
  private loadSub!: HTMLElement;

  /* map */
  private mapEl!: HTMLElement;
  private mapHint!: HTMLElement;
  private mapWorlds!: HTMLElement;
  private mapNodes!: HTMLElement;
  private mapStars!: HTMLElement;
  private mcEl!: HTMLElement;
  private mcNum!: HTMLElement;
  private mcName!: HTMLElement;
  private mcSub!: HTMLElement;
  private mcStatus!: HTMLElement;
  private mcDesc!: HTMLElement;
  private mcMech!: HTMLElement;
  private mcDiff!: HTMLElement;
  private mcOpt!: HTMLElement;
  private mcBest!: HTMLElement;
  private mcStars!: HTMLElement;
  private mcNote!: HTMLElement;
  private mcStart!: HTMLButtonElement;

  /* hud */
  private hudEl!: HTMLElement;
  private plate!: HTMLElement;
  private plateBody!: HTMLElement;
  private plateFold!: HTMLButtonElement;
  private hudWorld!: HTMLElement;
  private hudName!: HTMLElement;
  private hudSub!: HTMLElement;
  private hudGoal!: HTMLElement;
  private rulesToggle!: HTMLButtonElement;
  private rulesBody!: HTMLElement;
  private rulesList!: HTMLElement;
  private rulesCount!: HTMLElement;
  private btnHint!: HTMLButtonElement;
  private btnUndo!: HTMLButtonElement;
  private consoleEl!: HTMLElement;
  private vehName!: HTMLElement;
  private capBox!: HTMLElement;
  private capVal!: HTMLElement;
  private capStatus!: HTMLElement;
  private capIcon!: HTMLElement;
  private pipsEl!: HTMLElement;
  private weightEl!: HTMLElement;
  private weightFill!: HTMLElement;
  private chipsEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private timeBox!: HTMLElement;
  private timeVal!: HTMLElement;
  private timeFill!: HTMLElement;
  private timeNote!: HTMLElement;
  private timeBar!: HTMLElement;
  private movesVal!: HTMLElement;
  private costVal!: HTMLElement;
  private optBox!: HTMLElement;
  private optVal!: HTMLElement;
  private sailBtn!: HTMLButtonElement;
  private sailLabel!: HTMLElement;
  private sailVerb!: HTMLElement;
  private sailArrow!: HTMLElement;
  private sailDest!: HTMLElement;
  private sailReason!: HTMLElement;
  private sailReasonText!: HTMLElement;
  private rulesOpen = true;
  private plateOpen = true;
  private rulesTouched = false;
  private rulesKey = STALE;
  private chipsKey = STALE;
  private pipsKey = STALE;
  private capState = '';
  private lastMoves = -1;
  private lastCost = NaN;
  private lastHud: HudState | null = null;
  private ro: ResizeObserver | null = null;

  /* tooltip / toasts */
  private tip!: HTMLElement;
  private tipKey = '';
  private toastBox!: HTMLElement;

  /* hint */
  private hintEl!: HTMLElement;
  private hintDots!: HTMLElement;
  private hintStep!: HTMLElement;
  private hintTitle!: HTMLElement;
  private hintText!: HTMLElement;
  private hintMore!: HTMLButtonElement;

  /* pause / settings / win / fail */
  private pauseSub!: HTMLElement;
  private pauseResume!: HTMLButtonElement;
  private qualitySel!: HTMLSelectElement;
  private qualityHelp!: HTMLElement;
  private qualityAuto!: HTMLElement;
  private sliders: Array<{ input: HTMLInputElement; sync: () => void; key: 'musicVolume' | 'sfxVolume' | 'ambienceVolume' }> = [];
  private switches: Array<{ input: HTMLInputElement; key: 'muted' | 'reducedMotion' | 'skipSeenIntros' }> = [];
  private settingsClose!: HTMLButtonElement;
  private winTitle!: HTMLElement;
  private winLevel!: HTMLElement;
  private winStars!: HTMLElement;
  private winStats!: HTMLElement;
  private winBadges!: HTMLElement;
  private winEnd!: HTMLElement;
  private winNext!: HTMLButtonElement;
  private winReplay!: HTMLButtonElement;
  private failTitle!: HTMLElement;
  private failMsg!: HTMLElement;
  private failUndo!: HTMLButtonElement;
  private debugEl: HTMLElement | null = null;
  private debugText = '';

  constructor(root: HTMLElement, cb: UICallbacks) {
    this.cb = cb;
    this.el = h('div', { class: 'rb-ui', 'data-theme': 'map', lang: 'de' });
    root.appendChild(this.el);

    this.buildBoot();
    this.buildLoading();
    this.buildMap();
    this.buildHud();
    this.buildTipAndToasts();
    this.buildHint();
    this.buildPause();
    this.buildSettings();
    this.buildWin();
    this.buildFail();
    this.buildSkip();
    this.wireGlobal();
    this.preloadFonts();
  }

  /* ---------------------------------------------------------------- public API */

  setTheme(theme: ThemeId): void {
    this.theme = theme;
    this.el.dataset.theme = theme;
  }

  get isModalOpen(): boolean {
    return this.pause.open || this.settings.open || this.win.open || this.fail.open;
  }

  showBoot(progress: number, text: string): void {
    const p = clamp(progress > 1 ? progress / 100 : progress, 0, 1);
    this.bootBar.style.transform = `scaleX(${p})`;
    this.bootProg.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    setText(this.bootText, text);
    this.boot.show();
  }

  hideBoot(): void {
    this.boot.hide();
  }

  showLoading(title: string, subtitle: string): void {
    setText(this.loadTitle, title);
    setText(this.loadSub, subtitle);
    this.loadSub.hidden = !subtitle;
    this.loading.show();
  }

  hideLoading(): void {
    this.loading.hide();
  }

  showMap(cards: MapCardInfo[]): void {
    this.cards = cards;
    this.renderMapProgress();
    if (this.selected) {
      const fresh = cards.find((c) => c.id === this.selected!.id);
      if (fresh) {
        this.selected = fresh;
        this.renderMapCard(fresh);
      }
    }
    this.map.show();
  }

  hideMap(): void {
    this.map.hide();
    this.mapCardLayer.hide();
    this.selected = null;
    this.mapHint.classList.remove('is-hidden');
  }

  selectMapCard(card: MapCardInfo | null): void {
    if (!card) {
      this.selected = null;
      this.mapCardLayer.hide();
      this.mapHint.classList.remove('is-hidden');
      return;
    }
    const swap = this.mapCardLayer.open;
    this.selected = card;
    this.renderMapCard(card);
    if (swap) {
      this.mcEl.classList.remove('is-swap');
      reflow(this.mcEl);
      this.mcEl.classList.add('is-swap');
    }
    this.mapCardLayer.show();
    this.mapHint.classList.add('is-hidden');
  }

  showHud(s: HudState): void {
    const compact = this.isCompact();
    this.rulesOpen = !compact;
    this.plateOpen = !compact;
    this.rulesTouched = false;
    this.lastMoves = -1;
    this.lastCost = NaN;
    this.chipsKey = STALE;
    this.pipsKey = STALE;
    this.rulesKey = STALE;
    this.capState = '';
    this.applyFold();
    this.renderHud(s);
    this.hud.show();
  }

  updateHud(s: HudState): void {
    if (!this.rulesTouched && this.rulesOpen && s.moves > 0 && (this.lastHud?.moves ?? 0) === 0) {
      this.rulesOpen = false;
      this.applyFold();
    }
    this.renderHud(s);
  }

  hideHud(): void {
    this.hud.hide();
    this.hintLayer.hide();
    this.hideTooltip();
  }

  showTooltip(x: number, y: number, title: string, lines: string[]): void {
    const key = `${title}\n${lines.join('\n')}`;
    if (key !== this.tipKey) {
      this.tipKey = key;
      this.tip.replaceChildren(
        h('div', { class: 'rb-tip-title' }, title),
        ...lines.map((l) => h('div', { class: 'rb-tip-line' }, l)),
      );
    }
    this.tip.classList.add('is-in');
    const w = this.tip.offsetWidth;
    const hh = this.tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let px = x + 16;
    let py = y + 18;
    if (px + w > vw - 8) px = x - w - 16;
    if (py + hh > vh - 8) py = y - hh - 16;
    px = clamp(px, 8, Math.max(8, vw - w - 8));
    py = clamp(py, 8, Math.max(8, vh - hh - 8));
    this.tip.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0)`;
  }

  hideTooltip(): void {
    this.tip.classList.remove('is-in');
  }

  toast(kind: 'valid' | 'invalid' | 'info', title: string, message: string, ms?: number): void {
    const dur = ms ?? (kind === 'invalid' ? 7000 : kind === 'valid' ? 2800 : 4200);
    const iconName: IconName = kind === 'valid' ? 'check' : kind === 'invalid' ? 'alert' : 'info';
    const key = `${kind}|${title}|${message}`;
    const t = h(
      'div',
      { class: `rb-toast rb-toast--${kind}`, role: kind === 'invalid' ? 'alert' : 'status', 'data-testid': 'toast', 'data-kind': kind, 'data-key': key },
      h('span', { class: 'rb-toast-ic' }, ic(iconName)),
      h('div', { class: 'rb-toast-body' }, h('div', { class: 'rb-toast-title' }, title), message ? h('div', { class: 'rb-toast-msg' }, message) : null),
      h('i', { class: 'rb-toast-timer', style: `animation-duration:${dur}ms` }),
    );
    // identical toast already visible -> replace it; keep at most 2 stacked
    let live = Array.from(this.toastBox.children).filter((c) => !c.classList.contains('is-out'));
    for (const c of live) {
      if (c.getAttribute('data-key') === key) c.remove();
    }
    live = live.filter((c) => c.isConnected);
    while (live.length >= 2) live.shift()?.remove();
    this.toastBox.appendChild(t);
    window.setTimeout(() => this.dismissToast(t), dur);
  }

  showHint(level: 1 | 2 | 3, title: string, text: string, canMore: boolean): void {
    this.hintDots.replaceChildren(
      ...[1, 2, 3].map((i) => h('i', { class: `rb-step${i <= level ? ' is-on' : ''}${i === level ? ' is-current' : ''}` })),
    );
    this.hintDots.setAttribute('aria-label', `Hinweisstufe ${level} von 3`);
    setText(this.hintStep, `Hinweis ${level} von 3`);
    setText(this.hintTitle, title);
    setText(this.hintText, text);
    this.hintMore.hidden = !canMore;
    this.hintEl.dataset.level = String(level);
    this.hintLayer.show();
  }

  hideHint(): void {
    this.hintLayer.hide();
  }

  showPause(levelName: string): void {
    setText(this.pauseSub, levelName);
    this.openModal(this.pause, this.pauseResume);
  }

  hidePause(): void {
    this.closeModal(this.pause);
  }

  showSettings(s: Settings): void {
    this.syncSettings(s);
    this.openModal(this.settings, this.settingsClose);
  }

  hideSettings(): void {
    this.closeModal(this.settings);
  }

  showWin(r: WinInfo): void {
    const stars = clamp(Math.round(r.stars), 0, 3);
    setText(this.winTitle, stars >= 3 ? 'Meisterhaft!' : stars === 2 ? 'Gut gemacht!' : 'Geschafft!');
    setText(this.winLevel, r.levelName);
    this.winStars.replaceChildren(
      ...[1, 2, 3].map((i) => h('span', { class: `rb-star${i <= stars ? ' is-earned' : ''}`, style: `--i:${i - 1}`, html: icon('star') })),
    );
    this.winStars.setAttribute('aria-label', `${stars} von 3 Sternen`);
    this.winStars.dataset.stars = String(stars);
    const row = (k: string, v: string, testid?: string): HTMLElement =>
      h('div', { class: 'rb-win-row' }, h('dt', null, k), h('dd', testid ? { 'data-testid': testid } : null, v));
    this.winStats.replaceChildren(
      row('Überfahrten', String(r.moves), 'win-moves'),
      row('Ergebnis', r.costText, 'win-cost'),
      row('Optimum', r.optimalText, 'win-optimal'),
    );
    const badges: HTMLElement[] = [];
    if (r.improved) badges.push(h('span', { class: 'rb-badge rb-badge--gold' }, ic('trophy'), 'Neuer Bestwert'));
    if (r.noHints) badges.push(h('span', { class: 'rb-badge' }, ic('bulb'), 'Ohne Hinweise gelöst'));
    if (r.unlockedName) badges.push(h('span', { class: 'rb-badge rb-badge--unlock' }, ic('unlock'), `Freigeschaltet: ${r.unlockedName}`));
    this.winBadges.replaceChildren(...badges);
    this.winBadges.hidden = badges.length === 0;
    this.winNext.hidden = !r.hasNext;
    this.winEnd.hidden = r.hasNext;
    this.openModal(this.win, r.hasNext ? this.winNext : this.winReplay);
  }

  hideWin(): void {
    this.closeModal(this.win);
  }

  showFail(title: string, message: string): void {
    setText(this.failTitle, title);
    setText(this.failMsg, message);
    this.openModal(this.fail, this.failUndo);
  }

  hideFail(): void {
    this.closeModal(this.fail);
  }

  setIntroSkip(visible: boolean): void {
    if (visible) this.skip.show();
    else this.skip.hide();
  }

  showDebug(text: string | null): void {
    if (text === null) {
      this.debugEl?.remove();
      this.debugEl = null;
      this.debugText = '';
      return;
    }
    if (!this.debugEl) {
      this.debugEl = h('div', { class: 'rb-debug', 'data-testid': 'debug-panel', 'aria-hidden': 'true' });
      this.el.appendChild(this.debugEl);
    }
    if (text !== this.debugText) {
      this.debugText = text;
      this.debugEl.textContent = text;
    }
  }

  /* ---------------------------------------------------------------- builders */

  private buildBoot(): void {
    this.bootBar = h('i');
    this.bootProg = h(
      'div',
      { class: 'rb-progress', role: 'progressbar', 'aria-label': 'Ladefortschritt', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
      this.bootBar,
    );
    this.bootText = h('div', { class: 'rb-boot-text' }, 'Wird vorbereitet …');
    const el = h(
      'div',
      { class: 'rb-boot', 'data-testid': 'boot-screen', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'rb-boot-glow' }),
      h(
        'div',
        { class: 'rb-boot-center' },
        h('div', { class: 'rb-boot-mark', html: logoMark(96) }),
        h('h1', { class: 'rb-logo' }, 'Riverbound'),
        h('div', { class: 'rb-logo-sub' }, h('i'), 'Fünf Ufer', h('i')),
        this.bootProg,
        this.bootText,
      ),
      h('div', { class: 'rb-boot-waves', 'aria-hidden': 'true', html: wavesSvg() }),
    );
    this.boot = new Layer(el, this.el, 800);
  }

  private buildLoading(): void {
    this.loadTitle = h('h2', { class: 'rb-loading-title' });
    this.loadSub = h('p', { class: 'rb-loading-sub' });
    const el = h(
      'div',
      { class: 'rb-loading', 'data-testid': 'loading-curtain', role: 'status', 'aria-live': 'polite' },
      h(
        'div',
        { class: 'rb-loading-inner' },
        h('div', { class: 'rb-loading-mark' }, ic('boat')),
        this.loadTitle,
        this.loadSub,
        h('div', { class: 'rb-loading-bar' }, h('i')),
      ),
    );
    this.loading = new Layer(el, this.el, 900);
  }

  private buildMap(): void {
    this.mapWorlds = h('b', { class: 'rb-prog-num' }, '0/5');
    this.mapNodes = h('div', { class: 'rb-prog-nodes' });
    this.mapStars = h('b', { class: 'rb-prog-num' }, '0/15');
    const progress = h(
      'div',
      { class: 'rb-panel rb-progcard', 'data-testid': 'map-progress' },
      h('div', { class: 'rb-prog-row' }, ic('compass'), h('span', { class: 'rb-prog-k' }, 'Welten'), this.mapWorlds),
      this.mapNodes,
      h('div', { class: 'rb-prog-row rb-prog-row--stars' }, ic('star'), h('span', { class: 'rb-prog-k' }, 'Sterne'), this.mapStars),
    );
    const settingsBtn = h(
      'button',
      { class: 'rb-btn rb-iconbtn', type: 'button', 'data-testid': 'btn-map-settings', 'aria-label': 'Einstellungen', 'data-tip': 'Einstellungen' },
      ic('settings'),
      h('span', { class: 'rb-iconbtn-label' }, 'Einstellungen'),
    );
    settingsBtn.addEventListener('click', () => this.cb.onOpenSettings());

    this.mapHint = h('div', { class: 'rb-map-hint', 'data-testid': 'map-hint' }, ic('compass'), h('span', null, 'Wähle eine Welt auf der Karte'));

    // info card
    this.mcNum = h('div', { class: 'rb-mc-num' });
    this.mcName = h('h2', { class: 'rb-mc-name', id: 'rb-mc-name' });
    this.mcSub = h('div', { class: 'rb-mc-sub' });
    this.mcStatus = h('div', { class: 'rb-mc-status' });
    this.mcDesc = h('p', { class: 'rb-mc-desc' });
    this.mcMech = h('span', { class: 'rb-fact-v' });
    this.mcDiff = h('span', { class: 'rb-fact-v rb-diff' });
    this.mcOpt = h('span', { class: 'rb-fact-v' });
    this.mcBest = h('span', { class: 'rb-fact-v' });
    this.mcStars = h('div', { class: 'rb-mc-stars', role: 'img' });
    this.mcNote = h('div', { class: 'rb-mc-note' });
    this.mcStart = h('button', { class: 'rb-btn rb-btn--primary rb-btn--lg', type: 'button', 'data-testid': 'btn-start-level' }, 'Reise starten', ic('arrow'));
    this.mcStart.addEventListener('click', () => {
      const c = this.selected;
      if (c && c.unlocked && c.valid) this.cb.onStartLevel(c.id);
    });
    const fact = (k: string, name: IconName, v: HTMLElement, testid: string): HTMLElement =>
      h('li', { class: 'rb-fact', 'data-testid': testid }, h('span', { class: 'rb-fact-k' }, ic(name), k), v);
    this.mcEl = h(
      'aside',
      { class: 'rb-panel rb-mapcard', 'data-testid': 'map-card', role: 'region', 'aria-labelledby': 'rb-mc-name' },
      h('div', { class: 'rb-mc-head' }, h('div', { class: 'rb-mc-badge' }, h('span', { class: 'rb-mc-badge-k' }, 'Welt'), this.mcNum), h('div', { class: 'rb-mc-titles' }, this.mcName, this.mcSub), this.mcStatus),
      this.mcDesc,
      h(
        'ul',
        { class: 'rb-facts' },
        fact('Mechanik', 'sparkle', this.mcMech, 'map-card-mechanic'),
        fact('Schwierigkeit', 'target', this.mcDiff, 'map-card-difficulty'),
        fact('Optimum', 'flag', this.mcOpt, 'map-card-optimal'),
        fact('Bestleistung', 'trophy', this.mcBest, 'map-card-best'),
      ),
      h('div', { class: 'rb-mc-foot' }, this.mcStars, this.mcStart),
      this.mcNote,
    );

    this.mapEl = h(
      'div',
      { class: 'rb-map', 'data-testid': 'map-screen' },
      h(
        'header',
        { class: 'rb-map-top' },
        h('div', { class: 'rb-brand' }, h('span', { class: 'rb-brand-mark', html: logoMark(46) }), h('div', null, h('div', { class: 'rb-logo rb-logo--sm' }, 'Riverbound'), h('div', { class: 'rb-brand-sub' }, 'Fünf Ufer'))),
        h('div', { class: 'rb-map-tools' }, progress, settingsBtn),
      ),
      this.mapHint,
    );
    this.map = new Layer(this.mapEl, this.el, 420);
    this.mapCardLayer = new Layer(this.mcEl, this.mapEl, 260);
  }

  private buildHud(): void {
    /* level plate */
    this.hudWorld = h('span', { class: 'rb-world-chip' });
    this.plateFold = h(
      'button',
      { class: 'rb-fold', type: 'button', 'aria-expanded': 'true', 'aria-label': 'Level-Details ein- oder ausklappen', 'data-tip': 'Details' },
      ic('chevron-down'),
    );
    this.plateFold.addEventListener('click', () => {
      this.plateOpen = !this.plateOpen;
      this.applyFold();
    });
    this.hudName = h('h2', { class: 'rb-plate-title' });
    this.hudSub = h('p', { class: 'rb-plate-sub' });
    this.hudGoal = h('span', { class: 'rb-goal-text' });
    this.rulesCount = h('span', { class: 'rb-rules-count' });
    this.rulesToggle = h(
      'button',
      { class: 'rb-rules-toggle', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'rb-rules-body' },
      ic('book'),
      h('span', { class: 'rb-rules-label' }, 'Regeln'),
      this.rulesCount,
      ic('chevron-down', 'rb-chev'),
    );
    this.rulesToggle.addEventListener('click', () => {
      this.rulesOpen = !this.rulesOpen;
      this.rulesTouched = true;
      this.applyFold();
    });
    this.rulesList = h('ul', { class: 'rb-rules-list' });
    this.rulesBody = h('div', { class: 'rb-collapse', id: 'rb-rules-body' }, h('div', { class: 'rb-collapse-in' }, this.rulesList));
    this.plateBody = h(
      'div',
      { class: 'rb-collapse' },
      h(
        'div',
        { class: 'rb-collapse-in' },
        h('div', { class: 'rb-goal' }, ic('flag'), h('div', null, h('span', { class: 'rb-goal-k' }, 'Ziel'), this.hudGoal)),
        h('div', { class: 'rb-rules' }, this.rulesToggle, this.rulesBody),
      ),
    );
    this.plate = h(
      'section',
      { class: 'rb-panel rb-plate', 'data-testid': 'level-plate', 'aria-label': 'Level' },
      h('div', { class: 'rb-plate-head' }, this.hudWorld, this.plateFold),
      this.hudName,
      this.hudSub,
      this.plateBody,
    );

    /* action buttons */
    const action = (testid: string, name: IconName, label: string, tip: string, fn: () => void): HTMLButtonElement => {
      const b = h(
        'button',
        { class: 'rb-btn rb-iconbtn', type: 'button', 'data-testid': testid, 'aria-label': label, 'data-tip': tip },
        ic(name),
        h('span', { class: 'rb-iconbtn-label' }, label),
      );
      b.addEventListener('click', fn);
      return b;
    };
    this.btnHint = action('btn-hint', 'bulb', 'Hinweis', 'Hinweis anzeigen', () => this.cb.onHint());
    this.btnUndo = action('btn-undo', 'undo', 'Rückgängig', 'Letzte Überfahrt rückgängig machen', () => this.cb.onUndo());
    const btnReset = action('btn-reset', 'reset', 'Neu starten', 'Level neu starten', () => this.cb.onReset());
    const btnPause = action('btn-pause', 'pause', 'Pause', 'Pause-Menü öffnen', () => this.cb.onPause());
    const actions = h('div', { class: 'rb-actions', role: 'toolbar', 'aria-label': 'Spielaktionen' }, this.btnHint, this.btnUndo, btnReset, btnPause);

    /* vehicle console */
    this.vehName = h('div', { class: 'rb-veh-name' });
    this.capVal = h('span', { class: 'rb-cap-val', 'data-testid': 'hud-capacity' }, '0/0');
    this.capIcon = h('span', { class: 'rb-cap-ic' });
    this.capStatus = h('span', { class: 'rb-cap-status' });
    this.capBox = h('div', { class: 'rb-cap', 'data-state': 'empty' }, this.capVal, h('span', { class: 'rb-cap-tag' }, this.capIcon, this.capStatus));
    this.pipsEl = h('div', { class: 'rb-pips', 'aria-hidden': 'true' });
    this.weightFill = h('i');
    this.weightEl = h('div', { class: 'rb-weight', hidden: true, 'aria-hidden': 'true' }, this.weightFill, h('b', { class: 'rb-weight-tick' }));
    this.chipsEl = h('div', { class: 'rb-chips', role: 'list', 'aria-label': 'Im Boot' });

    this.timeVal = h('span', { class: 'rb-time-val', 'data-testid': 'hud-time' });
    this.timeNote = h('span', { class: 'rb-time-note' });
    this.timeFill = h('i');
    this.timeBar = h('div', { class: 'rb-time-bar', role: 'progressbar', 'aria-label': 'Zeitbudget', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, this.timeFill);
    this.timeBox = h('div', { class: 'rb-time', 'data-state': 'ok' }, h('div', { class: 'rb-time-head' }, ic('clock'), h('span', { class: 'rb-time-k' }, 'Zeit'), this.timeVal), this.timeBar, this.timeNote);
    this.movesVal = h('b', { class: 'rb-stat-v' }, '0');
    this.costVal = h('b', { class: 'rb-stat-v' }, '0');
    this.optVal = h('span', { class: 'rb-stat-v' });
    const stat = (name: IconName, testid: string | null, k: string, v: HTMLElement): HTMLElement =>
      h('div', { class: 'rb-stat' }, ic(name), h('span', testid ? { class: 'rb-stat-txt', 'data-testid': testid } : { class: 'rb-stat-txt' }, h('span', { class: 'rb-stat-k' }, k), ' ', v));
    this.optBox = stat('target', null, 'Optimum:', this.optVal);
    this.statsEl = h('div', { class: 'rb-stats' }, stat('boat', 'hud-moves', 'Überfahrten:', this.movesVal), stat('flag', 'hud-cost', 'Kosten:', this.costVal), this.optBox);

    this.sailVerb = h('span', { class: 'rb-sail-verb' }, 'Ablegen');
    this.sailArrow = h('span', { class: 'rb-sail-arrow', 'aria-hidden': 'true' }, '⟶');
    this.sailDest = h('span', { class: 'rb-sail-dest' });
    this.sailLabel = h('span', { class: 'rb-sail-label' }, this.sailVerb, ' ', this.sailArrow, ' ', this.sailDest);
    this.sailBtn = h('button', { class: 'rb-sail', type: 'button', 'data-testid': 'btn-sail', 'aria-describedby': 'rb-sail-reason' }, ic('boat', 'rb-sail-boat'), this.sailLabel);
    this.sailBtn.addEventListener('click', () => {
      if (this.lastHud?.busy) return;
      this.cb.onSail();
    });
    this.sailReasonText = h('span');
    this.sailReason = h('div', { class: 'rb-sail-reason', id: 'rb-sail-reason', 'aria-live': 'polite' }, ic('info'), this.sailReasonText);

    this.consoleEl = h(
      'section',
      { class: 'rb-panel rb-console', 'aria-label': 'Boot' },
      h(
        'div',
        { class: 'rb-c-veh' },
        h('div', { class: 'rb-veh-head' }, h('span', { class: 'rb-veh-badge' }, ic('boat')), this.vehName, this.capBox),
        this.pipsEl,
        this.weightEl,
        this.chipsEl,
      ),
      this.statsEl,
      h('div', { class: 'rb-c-sail' }, this.sailBtn, this.sailReason),
    );

    this.hudEl = h('div', { class: 'rb-hud', 'data-testid': 'hud' }, this.plate, actions, this.consoleEl);
    this.hud = new Layer(this.hudEl, this.el, 320);

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => {
        this.el.style.setProperty('--rb-console-h', this.consoleEl.isConnected ? `${this.consoleEl.offsetHeight}px` : '0px');
        this.el.style.setProperty('--rb-plate-h', this.plate.isConnected ? `${this.plate.offsetHeight}px` : '0px');
      });
      this.ro.observe(this.consoleEl);
      this.ro.observe(this.plate);
    }
  }

  private buildTipAndToasts(): void {
    this.tip = h('div', { class: 'rb-tip', role: 'tooltip' });
    this.el.appendChild(this.tip);
    this.toastBox = h('div', { class: 'rb-toasts', 'aria-live': 'polite' });
    this.el.appendChild(this.toastBox);
  }

  private buildHint(): void {
    this.hintDots = h('div', { class: 'rb-steps', role: 'img' });
    this.hintStep = h('span', { class: 'rb-hint-step' });
    this.hintTitle = h('div', { class: 'rb-hint-title' });
    this.hintText = h('p', { class: 'rb-hint-text', 'data-testid': 'hint-text', 'aria-live': 'polite' });
    this.hintMore = h('button', { class: 'rb-btn rb-btn--sm', type: 'button', 'data-testid': 'btn-hint-more' }, ic('sparkle'), 'Mehr Hilfe');
    this.hintMore.addEventListener('click', () => this.cb.onHintMore());
    const close = h('button', { class: 'rb-btn rb-close', type: 'button', 'data-testid': 'btn-hint-close', 'aria-label': 'Hinweis schließen' }, ic('x'));
    close.addEventListener('click', () => this.cb.onHintClose());
    this.hintEl = h(
      'aside',
      { class: 'rb-panel rb-hint', 'data-testid': 'hint-panel', role: 'region', 'aria-label': 'Hinweis' },
      h('div', { class: 'rb-hint-head' }, h('span', { class: 'rb-hint-ic' }, ic('bulb')), h('div', { class: 'rb-hint-heads' }, this.hintStep, this.hintTitle), close),
      this.hintText,
      h('div', { class: 'rb-hint-foot' }, this.hintDots, this.hintMore),
    );
    this.hintLayer = new Layer(this.hintEl, this.el, 260);
  }

  private modalFrame(cls: string, testid: string, labelId: string, ...content: Child[]): { root: HTMLElement; card: HTMLElement } {
    const card = h('div', { class: 'rb-panel rb-modal-card' }, ...content);
    const root = h('div', { class: `rb-modal ${cls}`, 'data-testid': testid, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelId }, card);
    return { root, card };
  }

  private buildPause(): void {
    this.pauseSub = h('div', { class: 'rb-modal-sub' });
    this.pauseResume = h('button', { class: 'rb-btn rb-btn--primary rb-btn--lg', type: 'button', 'data-testid': 'btn-resume' }, ic('play'), 'Weiterspielen');
    this.pauseResume.addEventListener('click', () => this.cb.onResume());
    const restart = h('button', { class: 'rb-btn rb-btn--lg', type: 'button', 'data-testid': 'btn-restart' }, ic('reset'), 'Neu starten');
    restart.addEventListener('click', () => this.cb.onRestart());
    const sett = h('button', { class: 'rb-btn rb-btn--lg', type: 'button', 'data-testid': 'btn-settings' }, ic('settings'), 'Einstellungen');
    sett.addEventListener('click', () => this.cb.onOpenSettings());
    const toMap = h('button', { class: 'rb-btn rb-btn--lg', type: 'button', 'data-testid': 'btn-to-map' }, ic('map'), 'Zur Weltkarte');
    toMap.addEventListener('click', () => this.cb.onToMap());
    const f = this.modalFrame(
      'rb-pause',
      'pause-menu',
      'rb-pause-title',
      h('div', { class: 'rb-modal-kicker' }, ic('pause'), 'Pause'),
      h('h2', { class: 'rb-modal-title', id: 'rb-pause-title' }, 'Kurze Rast am Ufer'),
      this.pauseSub,
      h('div', { class: 'rb-stack' }, this.pauseResume, restart, sett, toMap),
    );
    this.pause = new Layer(f.root, this.el, 260);
  }

  private buildSettings(): void {
    /* quality */
    this.qualitySel = h('select', { class: 'rb-select', 'data-testid': 'select-quality', id: 'rb-quality', 'data-sfx': true });
    for (const q of QUALITY_ORDER) this.qualitySel.append(h('option', { value: q }, QUALITY_PRESETS[q].label));
    this.qualityHelp = h('div', { class: 'rb-row-hint', id: 'rb-quality-help' });
    this.qualityAuto = h('div', { class: 'rb-row-hint rb-row-hint--auto' }, ic('sparkle'), 'Automatisch gewählt – deine Auswahl ersetzt die Automatik.');
    this.qualitySel.setAttribute('aria-describedby', 'rb-quality-help');
    this.qualitySel.addEventListener('change', () => {
      const q = this.qualitySel.value as QualityLevel;
      this.qualityHelp.textContent = QUALITY_HELP[q] ?? '';
      this.qualityAuto.hidden = true;
      this.cb.onSettingsChange({ quality: q, qualityAuto: false });
      this.cb.onUiSound('click');
    });
    const qualityRow = h(
      'div',
      { class: 'rb-row rb-row--select' },
      h('label', { class: 'rb-row-text', for: 'rb-quality' }, h('span', { class: 'rb-row-title' }, ic('monitor'), 'Grafikqualität'), this.qualityHelp),
      this.qualitySel,
    );

    const slider = (key: 'musicVolume' | 'sfxVolume' | 'ambienceVolume', label: string, testid: string, hint: string): HTMLElement => {
      const id = `rb-${testid}`;
      const input = h('input', { class: 'rb-range', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, id, 'data-testid': testid, 'data-sfx': true });
      const out = h('output', { class: 'rb-range-out', for: id }, '50 %');
      const sync = (): void => {
        const v = Number(input.value);
        input.style.setProperty('--p', `${Math.round(v * 100)}%`);
        out.textContent = `${Math.round(v * 100)} %`;
        input.setAttribute('aria-valuetext', `${Math.round(v * 100)} Prozent`);
      };
      input.addEventListener('input', () => {
        sync();
        const patch: Partial<Settings> = {};
        patch[key] = Number(input.value);
        this.cb.onSettingsChange(patch);
      });
      this.sliders.push({ input, sync, key });
      return h('div', { class: 'rb-row rb-row--range' }, h('label', { class: 'rb-row-text', for: id }, h('span', { class: 'rb-row-title' }, ic('volume'), label), hint ? h('span', { class: 'rb-row-hint' }, hint) : null), h('div', { class: 'rb-range-wrap' }, input, out));
    };

    const toggle = (key: 'muted' | 'reducedMotion' | 'skipSeenIntros', label: string, hint: string, testid: string, iconName: IconName): HTMLElement => {
      const id = `rb-${testid}`;
      const input = h('input', { class: 'rb-switch', type: 'checkbox', role: 'switch', id, 'data-testid': testid, 'data-sfx': true });
      input.addEventListener('change', () => {
        const patch: Partial<Settings> = {};
        patch[key] = input.checked;
        if (key === 'reducedMotion') this.applyMotion(input.checked);
        this.cb.onSettingsChange(patch);
        this.cb.onUiSound('click');
      });
      this.switches.push({ input, key });
      return h('label', { class: 'rb-row rb-row--switch', for: id }, h('span', { class: 'rb-row-text' }, h('span', { class: 'rb-row-title' }, ic(iconName), label), h('span', { class: 'rb-row-hint' }, hint)), input);
    };

    this.settingsClose = h('button', { class: 'rb-btn rb-btn--primary rb-btn--lg', type: 'button', 'data-testid': 'btn-settings-close' }, ic('check'), 'Fertig');
    this.settingsClose.addEventListener('click', () => this.cb.onCloseSettings());

    const f = this.modalFrame(
      'rb-settings',
      'settings-panel',
      'rb-settings-title',
      h('div', { class: 'rb-modal-kicker' }, ic('settings'), 'Optionen'),
      h('h2', { class: 'rb-modal-title', id: 'rb-settings-title' }, 'Einstellungen'),
      h(
        'div',
        { class: 'rb-settings-body' },
        h('section', { class: 'rb-group' }, h('h3', { class: 'rb-group-title' }, 'Grafik'), qualityRow, this.qualityAuto),
        h(
          'section',
          { class: 'rb-group' },
          h('h3', { class: 'rb-group-title' }, 'Audio'),
          slider('musicVolume', 'Musik', 'range-music', ''),
          slider('sfxVolume', 'Effekte', 'range-sfx', ''),
          slider('ambienceVolume', 'Umgebung', 'range-ambience', ''),
          toggle('muted', 'Alles stumm schalten', 'Schaltet Musik und Effekte aus', 'toggle-mute', 'mute'),
        ),
        h(
          'section',
          { class: 'rb-group' },
          h('h3', { class: 'rb-group-title' }, 'Bedienung'),
          toggle('reducedMotion', 'Weniger Bewegung', 'Reduziert Kamerabewegung und Wackeln', 'toggle-reduced-motion', 'motion'),
          toggle('skipSeenIntros', 'Bekannte Intros überspringen', 'Kamerafahrten nur beim ersten Besuch zeigen', 'toggle-skip-intros', 'skip'),
        ),
      ),
      h('div', { class: 'rb-modal-actions' }, this.settingsClose),
    );
    this.settings = new Layer(f.root, this.el, 260);
  }

  private buildWin(): void {
    this.winTitle = h('h2', { class: 'rb-modal-title rb-win-title', id: 'rb-win-title' });
    this.winLevel = h('div', { class: 'rb-modal-sub' });
    this.winStars = h('div', { class: 'rb-stars', role: 'img', 'data-testid': 'win-stars' });
    this.winStats = h('dl', { class: 'rb-win-stats' });
    this.winBadges = h('div', { class: 'rb-badges' });
    this.winEnd = h('div', { class: 'rb-win-end' }, ic('anchor'), 'Das letzte Ufer ist erreicht – die Reise ist vollendet.');
    this.winNext = h('button', { class: 'rb-btn rb-btn--primary rb-btn--lg', type: 'button', 'data-testid': 'btn-next-level' }, 'Nächste Welt', ic('arrow'));
    this.winNext.addEventListener('click', () => this.cb.onNextLevel());
    this.winReplay = h('button', { class: 'rb-btn rb-btn--lg', type: 'button', 'data-testid': 'btn-replay' }, ic('reset'), 'Nochmal spielen');
    this.winReplay.addEventListener('click', () => this.cb.onReplay());
    const toMap = h('button', { class: 'rb-btn rb-btn--lg', type: 'button', 'data-testid': 'btn-win-map' }, ic('map'), 'Zur Weltkarte');
    toMap.addEventListener('click', () => this.cb.onToMap());
    const f = this.modalFrame(
      'rb-win',
      'win-dialog',
      'rb-win-title',
      h('div', { class: 'rb-modal-kicker' }, ic('flag'), 'Ufer erreicht'),
      this.winTitle,
      this.winLevel,
      this.winStars,
      this.winStats,
      this.winBadges,
      this.winEnd,
      h('div', { class: 'rb-stack rb-stack--win' }, this.winNext, this.winReplay, toMap),
    );
    this.win = new Layer(f.root, this.el, 300);
  }

  private buildFail(): void {
    this.failTitle = h('h2', { class: 'rb-modal-title', id: 'rb-fail-title' });
    this.failMsg = h('p', { class: 'rb-fail-msg' });
    this.failUndo = h('button', { class: 'rb-btn rb-btn--primary rb-btn--lg', type: 'button', 'data-testid': 'btn-fail-undo' }, ic('undo'), 'Rückgängig');
    this.failUndo.addEventListener('click', () => this.cb.onUndo());
    const restart = h('button', { class: 'rb-btn rb-btn--lg', type: 'button', 'data-testid': 'btn-fail-restart' }, ic('reset'), 'Neu starten');
    restart.addEventListener('click', () => this.cb.onRestart());
    const f = this.modalFrame(
      'rb-fail',
      'fail-dialog',
      'rb-fail-title',
      h('div', { class: 'rb-fail-ic' }, ic('alert')),
      this.failTitle,
      this.failMsg,
      h('div', { class: 'rb-stack rb-stack--row' }, this.failUndo, restart),
    );
    f.root.setAttribute('role', 'alertdialog');
    this.fail = new Layer(f.root, this.el, 260);
  }

  private buildSkip(): void {
    const b = h('button', { class: 'rb-btn rb-skip', type: 'button', 'data-testid': 'btn-skip-intro' }, 'Überspringen', ic('skip'));
    b.addEventListener('click', () => this.cb.onSkipIntro());
    this.skip = new Layer(b, this.el, 240);
  }

  /* ---------------------------------------------------------------- behaviour */

  private wireGlobal(): void {
    const hoverSel = 'button, select, input, [data-sfx]';
    this.el.addEventListener('pointerover', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const target = e.target as Element | null;
      const t = target?.closest?.(hoverSel);
      if (!t || t.matches(':disabled')) return;
      const from = e.relatedTarget as Node | null;
      if (from && t.contains(from)) return;
      this.cb.onUiSound('hover');
    });
    this.el.addEventListener('click', (e) => {
      const t = (e.target as Element | null)?.closest?.('button');
      if (!t || t.matches(':disabled')) return;
      this.cb.onUiSound('click');
    });
    // Wheel over panels must never zoom the 3D camera.
    this.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    // Focus trap for the top-most modal.
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const top = this.topModal();
      if (!top) return;
      const list = Array.from(top.el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!active || !top.el.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  private preloadFonts(): void {
    try {
      const fonts = document.fonts;
      if (!fonts) return;
      for (const f of FONT_LOADS) void fonts.load(f).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  private topModal(): Layer | null {
    for (let i = this.modalOrder.length - 1; i >= 0; i--) {
      const m = this.modalOrder[i];
      if (m && m.layer.open) return m.layer;
    }
    return null;
  }

  private openModal(layer: Layer, focus: HTMLElement | null): void {
    if (!layer.open) {
      const prev = document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement) ? document.activeElement : null;
      this.modalOrder = this.modalOrder.filter((m) => m.layer !== layer);
      this.modalOrder.push({ layer, prev });
    }
    layer.show();
    if (focus) window.setTimeout(() => layer.open && focus.focus({ preventScroll: true }), 40);
  }

  private closeModal(layer: Layer): void {
    if (!layer.open) return;
    layer.hide();
    const i = this.modalOrder.findIndex((m) => m.layer === layer);
    if (i < 0) return;
    const entry = this.modalOrder.splice(i, 1)[0];
    const prev = entry?.prev;
    if (prev && prev.isConnected && !prev.matches(':disabled')) prev.focus({ preventScroll: true });
  }

  private dismissToast(t: HTMLElement): void {
    if (!t.isConnected || t.classList.contains('is-out')) return;
    t.setAttribute('data-testid', 'toast-leaving');
    t.classList.add('is-out');
    window.setTimeout(() => t.remove(), 280);
  }

  private isCompact(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px), (max-height: 520px)').matches;
  }

  private applyMotion(reduced: boolean): void {
    if (reduced) this.el.dataset.motion = 'reduced';
    else delete this.el.dataset.motion;
  }

  private applyFold(): void {
    this.plateBody.classList.toggle('is-open', this.plateOpen);
    this.plateFold.setAttribute('aria-expanded', String(this.plateOpen));
    this.plate.classList.toggle('is-folded', !this.plateOpen);
    this.rulesBody.classList.toggle('is-open', this.rulesOpen);
    this.rulesToggle.setAttribute('aria-expanded', String(this.rulesOpen));
    this.rulesToggle.classList.toggle('is-open', this.rulesOpen);
  }

  private syncSettings(s: Settings): void {
    this.qualitySel.value = s.quality;
    this.qualityHelp.textContent = QUALITY_HELP[s.quality] ?? '';
    this.qualityAuto.hidden = !s.qualityAuto;
    for (const sl of this.sliders) {
      sl.input.value = String(s[sl.key]);
      sl.sync();
    }
    for (const sw of this.switches) sw.input.checked = Boolean(s[sw.key]);
    this.applyMotion(s.reducedMotion);
  }

  /* ---------------------------------------------------------------- rendering */

  private worldNumber(levelName: string): number | null {
    const c = this.cards.find((k) => k.name === levelName);
    if (c && this.cards.length) {
      const base = Math.min(...this.cards.map((k) => k.index));
      return c.index - base + 1;
    }
    const i = THEME_ORDER.indexOf(this.theme);
    return i >= 0 ? i + 1 : null;
  }

  private renderMapProgress(): void {
    const total = this.cards.length || 5;
    const done = this.cards.filter((c) => c.completed).length;
    const stars = this.cards.reduce((a, c) => a + clamp(c.stars, 0, 3), 0);
    setText(this.mapWorlds, `${done}/${total}`);
    this.mapWorlds.setAttribute('aria-label', `${done} von ${total} Welten abgeschlossen`);
    setText(this.mapStars, `${stars}/${total * 3}`);
    this.mapStars.setAttribute('aria-label', `${stars} von ${total * 3} Sternen`);
    const base = this.cards.length ? Math.min(...this.cards.map((k) => k.index)) : 0;
    this.mapNodes.replaceChildren(
      ...this.cards.map((c) => {
        const st = !c.unlocked ? 'locked' : c.completed ? 'done' : 'open';
        const label = st === 'locked' ? 'gesperrt' : st === 'done' ? 'abgeschlossen' : 'bereit';
        return h('span', { class: `rb-node rb-node--${st}`, title: `${c.name} – ${label}`, role: 'img', 'aria-label': `Welt ${c.index - base + 1}: ${c.name}, ${label}` }, st === 'locked' ? ic('lock') : st === 'done' ? ic('check') : String(c.index - base + 1));
      }),
    );
  }

  private renderMapCard(c: MapCardInfo): void {
    const base = this.cards.length ? Math.min(...this.cards.map((k) => k.index)) : 0;
    const status = !c.unlocked ? 'locked' : c.completed ? 'completed' : 'open';
    this.mcEl.dataset.id = c.id;
    this.mcEl.dataset.world = c.id;
    this.mcEl.dataset.status = status;
    setText(this.mcNum, String(c.index - base + 1));
    setText(this.mcName, c.name);
    setText(this.mcSub, c.subtitle);
    setText(this.mcDesc, c.description);
    setText(this.mcMech, c.mechanic);
    setText(this.mcOpt, c.optimal || '–');
    setText(this.mcBest, c.best ?? 'Noch nicht gespielt');
    this.mcStatus.replaceChildren(
      ic(status === 'locked' ? 'lock' : status === 'completed' ? 'check' : 'compass'),
      h('span', null, status === 'locked' ? 'Gesperrt' : status === 'completed' ? 'Abgeschlossen' : 'Bereit'),
    );
    this.mcStatus.dataset.status = status;
    const d = clamp(c.difficulty, 1, 5);
    this.mcDiff.replaceChildren(
      h('span', { class: 'rb-pips rb-pips--diff', role: 'img', 'aria-label': `Schwierigkeit ${d} von 5` }, ...[1, 2, 3, 4, 5].map((i) => h('i', { class: i <= d ? 'is-on' : '' }))),
      h('span', { class: 'rb-diff-word' }, DIFFICULTY_WORDS[d - 1] ?? ''),
    );
    const stars = clamp(Math.round(c.stars), 0, 3);
    this.mcStars.replaceChildren(...[1, 2, 3].map((i) => h('span', { class: `rb-star rb-star--sm${i <= stars ? ' is-earned is-static' : ''}`, html: icon('star') })));
    this.mcStars.setAttribute('aria-label', `${stars} von 3 Sternen`);
    this.mcStars.dataset.stars = String(stars);
    const blocked = !c.unlocked || !c.valid;
    this.mcStart.disabled = blocked;
    this.mcNote.hidden = !blocked;
    this.mcNote.replaceChildren(
      ic(!c.unlocked ? 'lock' : 'alert'),
      h('span', null, !c.unlocked ? 'Schließe zuerst die vorherige Welt ab, um diese Reise anzutreten.' : 'Diese Welt ist derzeit nicht spielbar.'),
    );
  }

  private renderHud(s: HudState): void {
    const prev = this.lastHud;
    this.lastHud = s;

    /* plate */
    const w = this.worldNumber(s.levelName);
    setText(this.hudWorld, w ? `Welt ${w}` : 'Level');
    setText(this.hudName, s.levelName);
    setText(this.hudSub, s.subtitle);
    this.hudSub.hidden = !s.subtitle;
    setText(this.hudGoal, s.goal);
    const rk = s.rules.join('\u0001');
    if (rk !== this.rulesKey) {
      this.rulesKey = rk;
      this.rulesList.replaceChildren(...s.rules.map((r) => h('li', { class: 'rb-rule' }, ic(ruleIcon(r)), h('span', null, r))));
      setText(this.rulesCount, String(s.rules.length));
      this.rulesToggle.hidden = s.rules.length === 0;
      this.rulesBody.hidden = s.rules.length === 0;
    }

    /* actions */
    this.btnUndo.disabled = !s.undoAvailable;

    /* vehicle */
    setText(this.vehName, s.vehicleName);
    const used = s.load.length;
    const overSeats = used > s.capacity;
    const overWeight = !!s.weight && s.weight.current > s.weight.max;
    const full = s.weight ? s.weight.current === s.weight.max || used >= s.capacity : used >= s.capacity && s.capacity > 0;
    const state = overSeats || overWeight ? 'over' : full && used > 0 ? 'full' : used === 0 ? 'empty' : 'ok';
    const capText = s.weight ? `${fmt(s.weight.current)}/${fmt(s.weight.max)} kg` : `${used}/${s.capacity}`;
    setText(this.capVal, capText);
    const statusText =
      state === 'over' ? (overWeight ? 'Zu schwer' : 'Überladen') : state === 'full' ? 'Voll' : state === 'empty' ? 'Leer' : s.weight ? 'Im Limit' : 'Frei';
    setText(this.capStatus, statusText);
    const stateKey = `${state}`;
    if (stateKey !== this.capState) {
      this.capState = stateKey;
      this.capBox.dataset.state = state;
      this.consoleEl.dataset.cap = state;
      this.capVal.dataset.state = state;
      this.capIcon.innerHTML = icon(state === 'over' ? 'alert' : state === 'full' ? 'check' : 'users');
    }
    this.capVal.setAttribute('aria-label', `Belegung ${capText}, ${statusText}`);

    const pk = `${s.capacity}|${used}`;
    if (pk !== this.pipsKey) {
      this.pipsKey = pk;
      const n = s.capacity > 0 && s.capacity <= 10 ? s.capacity : 0;
      this.pipsEl.hidden = n === 0;
      this.pipsEl.replaceChildren(...Array.from({ length: n }, (_, i) => h('i', { class: i < used ? 'is-on' : '' })));
    }

    this.weightEl.hidden = !s.weight;
    if (s.weight) {
      const ratio = s.weight.max > 0 ? s.weight.current / s.weight.max : 0;
      this.weightFill.style.width = `${(clamp(ratio, 0, 1.25) / 1.25) * 100}%`;
      this.weightEl.dataset.state = state;
    }

    const ck = s.load.map((l) => `${l.id}:${l.name}`).join('|');
    if (ck !== this.chipsKey) {
      this.chipsKey = ck;
      if (s.load.length === 0) {
        this.chipsEl.replaceChildren(h('span', { class: 'rb-chips-empty' }, 'Boot ist leer – wähle eine Figur am Ufer.'));
      } else {
        this.chipsEl.replaceChildren(
          ...s.load.map((l) => {
            const chip = h(
              'button',
              { class: 'rb-chip', type: 'button', role: 'listitem', 'data-testid': 'load-chip', 'data-id': l.id, 'aria-label': `${l.name} aussteigen lassen`, 'data-tip': 'Aussteigen' },
              h('span', { class: 'rb-chip-av', 'aria-hidden': 'true' }, (l.name.trim().charAt(0) || '?').toUpperCase()),
              h('span', { class: 'rb-chip-name' }, l.name),
              ic('exit', 'rb-chip-out'),
            );
            chip.addEventListener('click', () => this.cb.onUnboard(l.id));
            return chip;
          }),
        );
      }
    }

    /* stats */
    if (s.metric === 'time') {
      if (this.timeBox.parentElement !== this.statsEl) this.statsEl.prepend(this.timeBox);
      const limitTxt = s.limit !== null ? ` / ${fmt(s.limit)}` : '';
      setText(this.timeVal, `${fmt(s.cost)}${limitTxt} ${s.unit}`);
      const ratio = s.limit && s.limit > 0 ? s.cost / s.limit : 0;
      const ts = s.limit === null ? 'ok' : ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
      this.timeBox.dataset.state = ts;
      this.timeFill.style.width = `${s.limit === null ? 100 : clamp(ratio, 0, 1) * 100}%`;
      this.timeBar.hidden = s.limit === null;
      this.timeBar.setAttribute('aria-valuenow', String(Math.round(clamp(ratio, 0, 1) * 100)));
      setText(this.timeNote, ts === 'over' ? 'Zeitlimit überschritten' : ts === 'warn' ? (ratio >= 1 ? 'Zeitbudget aufgebraucht' : 'Zeit wird knapp') : '');
      this.timeNote.hidden = ts === 'ok';
    } else if (this.timeBox.parentElement) {
      this.timeBox.remove();
    }

    setText(this.movesVal, String(s.moves));
    if (this.lastMoves !== -1 && s.moves !== this.lastMoves) this.bump(this.movesVal);
    this.lastMoves = s.moves;
    const limitTxt2 = s.limit !== null ? ` / ${fmt(s.limit)}` : '';
    setText(this.costVal, `${fmt(s.cost)}${limitTxt2} ${s.unit}`.trim());
    if (!Number.isNaN(this.lastCost) && s.cost !== this.lastCost) this.bump(this.costVal);
    this.lastCost = s.cost;
    const over = s.limit !== null && s.cost > s.limit;
    this.costVal.parentElement?.parentElement?.classList.toggle('is-bad', over);
    setText(this.optVal, s.optimalText);
    this.optBox.hidden = !s.optimalText;

    /* sail */
    const blocked = !s.canSail && !s.busy;
    this.sailBtn.disabled = s.busy;
    this.sailBtn.classList.toggle('is-soft', blocked);
    this.sailBtn.classList.toggle('is-busy', s.busy);
    const dest = s.destination || 'anderes Ufer';
    setText(this.sailVerb, s.busy ? 'Unterwegs …' : 'Ablegen');
    this.sailArrow.hidden = s.busy;
    this.sailDest.hidden = s.busy;
    setText(this.sailDest, dest);
    this.sailBtn.setAttribute('aria-label', s.busy ? 'Das Boot ist unterwegs' : `Ablegen nach ${dest}`);
    let reason = '';
    if (s.busy) reason = 'Das Boot ist unterwegs …';
    else if (!s.canSail) {
      if (s.load.length === 0) reason = 'Setze zuerst jemanden ins Boot.';
      else if (overWeight && s.weight) reason = `Zu schwer: ${fmt(s.weight.current)}/${fmt(s.weight.max)} kg – lass jemanden aussteigen.`;
      else if (overSeats) reason = `Zu viele im Boot (höchstens ${s.capacity}).`;
      else reason = 'Diese Überfahrt ist gerade nicht möglich – klicke für eine Erklärung.';
    }
    setText(this.sailReasonText, reason);
    this.sailReason.classList.toggle('is-empty', reason === '');
    this.sailReason.dataset.kind = s.busy ? 'busy' : blocked ? 'blocked' : '';
    if (prev && prev.levelName !== s.levelName) this.rulesKey = STALE;
  }

  private bump(node: HTMLElement): void {
    node.classList.remove('is-bump');
    reflow(node);
    node.classList.add('is-bump');
  }
}
