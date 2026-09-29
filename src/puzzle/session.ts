import { bitsOf, capitalize, popcount, PuzzleModel, type PuzzleState } from './engine';
import { generateHint, type Hint, type HintLevel } from './hints';
import { solve, type Solution } from './solver';
import type { CrossingAction, Side, Violation } from './types';

export type EntityLocation = 'left' | 'right' | 'boat';

export interface HistoryEntry {
  before: PuzzleState;
  /** Group that crossed (bitmask). */
  group: number;
  cost: number;
  from: Side;
  to: Side;
}

export interface BoardResult {
  ok: boolean;
  /** true if the entity is now aboard. */
  aboard: boolean;
  violation?: Violation;
}

export interface DepartureCheck {
  ok: boolean;
  violations: Violation[];
  cost: number;
  next: PuzzleState;
  group: number;
}

export interface SailResult extends DepartureCheck {
  action?: CrossingAction;
  from: Side;
  to: Side;
  won: boolean;
  failed: boolean;
}

/**
 * Runtime state of one level attempt. Pure logic (no rendering), fully unit-testable.
 * Entities sitting in the docked vehicle belong – logically – to the bank the vehicle is at;
 * the rules are only evaluated when the vehicle departs (both banks + the travelling group).
 */
export class PuzzleSession {
  readonly model: PuzzleModel;
  state: PuzzleState;
  /** Entities staged aboard (all on the vehicle's side). */
  load = 0;
  elapsed = 0;
  moves = 0;
  hintsUsed = 0;
  undosUsed = 0;
  history: HistoryEntry[] = [];
  /** Hint stage already revealed for the current state (0 = none). */
  hintStage: 0 | HintLevel = 0;
  private readonly sticky: number;
  private optimalCache: Solution | null | undefined;

  constructor(model: PuzzleModel) {
    this.model = model;
    this.sticky = model.maskOf(model.def.vehicle.stickyPilots ?? []);
    this.state = model.startState;
    this.reset();
  }

  // ───────────────────────── queries ─────────────────────────

  get vehicleSide(): Side {
    return this.model.vehicleSide(this.state);
  }

  get won(): boolean {
    return this.model.isGoal(this.state);
  }

  get limit(): number | null {
    return this.model.def.cost.type === 'slowest' ? (this.model.def.cost.limit ?? null) : null;
  }

  get remainingBudget(): number | null {
    const l = this.limit;
    return l === null ? null : l - this.elapsed;
  }

  /** Optimal cost of the whole level (computed once by the solver). */
  get optimal(): Solution | null {
    if (this.optimalCache === undefined) this.optimalCache = solve(this.model);
    return this.optimalCache;
  }

  /** No legal crossing fits into the remaining budget any more (time levels only). */
  get failed(): boolean {
    if (this.won) return false;
    const budget = this.remainingBudget;
    if (budget === null) return false;
    return !this.model.legalActions(this.state).some((a) => a.cost <= budget);
  }

  location(id: string): EntityLocation {
    const i = this.model.indexOf(id);
    if (this.load & (1 << i)) return 'boat';
    return this.model.sideOf(this.state, i) === 0 ? 'left' : 'right';
  }

  isAboard(id: string): boolean {
    return !!(this.load & (1 << this.model.indexOf(id)));
  }

  isSticky(id: string): boolean {
    return !!(this.sticky & (1 << this.model.indexOf(id)));
  }

  loadIds(): string[] {
    return this.model.idsOf(this.load);
  }

  loadWeight(): number {
    return this.model.weightOf(this.load);
  }

  loadCount(): number {
    return popcount(this.load);
  }

  /** Current preview cost of departing with the staged group. */
  loadCost(): number {
    return this.load ? this.model.crossingCost(this.load) : 0;
  }

  // ───────────────────────── staging ─────────────────────────

  canBoard(id: string): Violation | null {
    const m = this.model;
    const i = m.indexOf(id);
    const bit = 1 << i;
    const vn = m.def.vehicleNames;
    if (this.won) {
      return { kind: 'won', entities: [id], title: 'Geschafft', message: 'Das Rätsel ist bereits gelöst.' };
    }
    if (this.load & bit) return null;
    if (m.sideOf(this.state, i) !== this.vehicleSide) {
      return {
        kind: 'notAtVehicle',
        entities: [id],
        title: 'Falsches Ufer',
        message: `${capitalize(m.nom(i))} steht ${m.def.sides[m.sideOf(this.state, i)].at}, aber ${vn.nom} liegt ${m.def.sides[this.vehicleSide].at}.`,
        icon: 'shore',
      };
    }
    const cap = m.def.vehicle.capacity;
    if (popcount(this.load) + 1 > cap) {
      return {
        kind: 'capacity',
        entities: [...this.loadIds(), id],
        title: 'Kein Platz mehr',
        message: `${capitalize(vn.nom)} trägt höchstens ${cap} ${cap === 1 ? 'Figur' : 'Figuren'}. Hol erst jemanden ${vn.from}.`,
        icon: 'capacity',
      };
    }
    const maxW = m.def.vehicle.maxWeight;
    if (maxW !== undefined) {
      const w = this.loadWeight() + m.weights[i]!;
      if (w > maxW) {
        return {
          kind: 'weight',
          entities: [...this.loadIds(), id],
          title: 'Zu schwer',
          message: `${capitalize(vn.nom)} trägt maximal ${maxW} kg. Mit ${m.dat(i)} (${m.weights[i]} kg) wären es ${w} kg.`,
          icon: 'weight',
        };
      }
    }
    return null;
  }

  board(id: string): BoardResult {
    const v = this.canBoard(id);
    if (v) return { ok: false, aboard: this.isAboard(id), violation: v };
    this.load |= 1 << this.model.indexOf(id);
    return { ok: true, aboard: true };
  }

  unboard(id: string): BoardResult {
    const m = this.model;
    const i = m.indexOf(id);
    const bit = 1 << i;
    if (!(this.load & bit)) return { ok: true, aboard: false };
    if (this.sticky & bit) {
      return {
        ok: false,
        aboard: true,
        violation: {
          kind: 'noPilot',
          entities: [id],
          title: 'Bleibt am Ruder',
          message: `${capitalize(m.nom(i))} steuert ${m.def.vehicleNames.acc} und bleibt an Bord.`,
          icon: 'helm',
        },
      };
    }
    this.load &= ~bit;
    return { ok: true, aboard: false };
  }

  toggle(id: string): BoardResult {
    return this.isAboard(id) ? this.unboard(id) : this.board(id);
  }

  // ───────────────────────── crossing ─────────────────────────

  checkDeparture(): DepartureCheck {
    const m = this.model;
    const r = m.tryCrossing(this.state, this.load);
    const violations = [...r.violations];
    const budget = this.remainingBudget;
    if (budget !== null && this.load && r.cost > budget && !violations.some((v) => v.kind !== 'rule')) {
      const unit = m.def.cost.type === 'slowest' ? m.def.cost.unit : '';
      violations.unshift({
        kind: 'timeLimit',
        entities: this.loadIds(),
        title: 'Energie reicht nicht',
        message: `Die Energiezelle hat nur noch ${budget} ${unit}. Diese Überfahrt würde ${r.cost} ${unit} dauern – so lange braucht ${m.namesOf(this.load)}.`,
        icon: 'energy',
      });
    }
    return { ok: violations.length === 0, violations, cost: r.cost, next: r.next, group: this.load };
  }

  /** Departs with the staged group if legal. Otherwise nothing changes. */
  sail(): SailResult {
    const from = this.vehicleSide;
    const to = (1 - from) as Side;
    const check = this.checkDeparture();
    if (!check.ok) return { ...check, from, to, won: this.won, failed: this.failed };
    const action: CrossingAction = { group: this.load, to, cost: check.cost };
    this.history.push({ before: this.state, group: this.load, cost: check.cost, from, to });
    this.state = check.next;
    this.elapsed += check.cost;
    this.moves++;
    // Passengers disembark on arrival; sticky pilots stay at the helm.
    this.load &= this.sticky;
    this.hintStage = 0;
    return { ...check, action, from, to, won: this.won, failed: this.failed };
  }

  /** Reverts the last crossing; the group that crossed is back aboard at the previous bank. */
  undo(): HistoryEntry | null {
    const last = this.history.pop();
    if (!last) return null;
    this.state = last.before;
    this.elapsed -= last.cost;
    this.moves--;
    this.load = last.group;
    this.undosUsed++;
    this.hintStage = 0;
    return last;
  }

  reset(): void {
    this.state = this.model.startState;
    this.elapsed = 0;
    this.moves = 0;
    this.history = [];
    this.hintStage = 0;
    // sticky pilots start aboard if they are on the vehicle's side
    const side = this.model.vehicleSide(this.state);
    this.load = this.sticky & this.model.membersAt(this.state, side);
  }

  // ───────────────────────── hints ─────────────────────────

  /** Returns the next hint stage for the current state (1 → 2 → 3, then stays at 3). */
  nextHint(): Hint {
    const level = Math.min(3, this.hintStage + 1) as HintLevel;
    return this.hint(level);
  }

  hint(level: HintLevel): Hint {
    if (level > this.hintStage) {
      this.hintStage = level;
      this.hintsUsed++;
    }
    return generateHint(
      this.model,
      { state: this.state, load: this.load, elapsed: this.elapsed, history: this.history },
      level,
    );
  }

  /** Optimal remaining solution from the current state (used by QA automation and hint UI). */
  solveFromCurrent(): Solution | null {
    return solve(this.model, this.state);
  }

  /** Rating 1–3 stars: optimal = 3, ≤ optimal·1.5 = 2, otherwise 1. */
  rating(): number {
    const opt = this.optimal;
    if (!opt || !this.won) return 0;
    if (this.elapsed <= opt.cost) return 3;
    if (this.elapsed <= Math.ceil(opt.cost * 1.5)) return 2;
    return 1;
  }

  entityIdsAt(side: Side): string[] {
    const m = this.model;
    return bitsOf(m.membersAt(this.state, side) & ~this.load).map((i) => m.ids[i]!);
  }
}
