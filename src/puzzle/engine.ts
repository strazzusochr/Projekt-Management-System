import type {
  CrossingAction,
  EntityDef,
  GrammarForms,
  Location,
  PuzzleDefinition,
  RuleDef,
  SelectorDef,
  Side,
  Violation,
} from './types';

/**
 * State encoding: bit i (0 ≤ i < n) = side of entity i (1 = goal side), bit n = vehicle side.
 * With ≤ 20 entities this fits comfortably into a 32-bit integer.
 */
export type PuzzleState = number;

export function popcount(mask: number): number {
  let m = mask >>> 0;
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

export function bitsOf(mask: number): number[] {
  const out: number[] = [];
  let m = mask >>> 0;
  let i = 0;
  while (m) {
    if (m & 1) out.push(i);
    m >>>= 1;
    i++;
  }
  return out;
}

/** "A", "A und B", "A, B und C". */
export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

export function formatTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

export function capitalize(text: string): string {
  return text.length ? text[0]!.toUpperCase() + text.slice(1) : text;
}

interface CompiledRule {
  def: RuleDef;
  onVehicle: boolean;
  check(present: number, loc: Location): Violation | null;
}

export class PuzzleDefinitionError extends Error {}

export class PuzzleModel {
  readonly def: PuzzleDefinition;
  readonly n: number;
  readonly allMask: number;
  readonly vehicleBit: number;
  readonly ids: readonly string[];
  readonly entities: readonly EntityDef[];
  readonly pilotMask: number;
  readonly weights: readonly number[];
  readonly times: readonly number[];
  readonly startState: PuzzleState;
  readonly goalSide: Side;
  readonly goalMask: number;
  readonly totalStates: number;
  private readonly index = new Map<string, number>();
  private readonly forms: GrammarForms[];
  private readonly rules: CompiledRule[];

  constructor(def: PuzzleDefinition) {
    this.def = def;
    this.entities = def.entities;
    this.n = def.entities.length;
    if (this.n === 0) throw new PuzzleDefinitionError(`${def.id}: Level besitzt keine Figuren.`);
    if (this.n > 20) throw new PuzzleDefinitionError(`${def.id}: Zu viele Figuren (${this.n} > 20).`);
    this.allMask = (1 << this.n) - 1;
    this.vehicleBit = 1 << this.n;
    this.totalStates = 1 << (this.n + 1);
    this.ids = def.entities.map((e) => e.id);
    def.entities.forEach((e, i) => {
      if (this.index.has(e.id)) throw new PuzzleDefinitionError(`${def.id}: doppelte Figuren-ID "${e.id}".`);
      this.index.set(e.id, i);
    });
    this.forms = def.entities.map((e) => ({
      nom: e.forms?.nom ?? e.name,
      acc: e.forms?.acc ?? e.forms?.nom ?? e.name,
      dat: e.forms?.dat ?? e.forms?.nom ?? e.name,
    }));
    this.pilotMask = this.maskWhere((e) => !!e.canPilot);
    this.weights = def.entities.map((e) => e.weight ?? 0);
    this.times = def.entities.map((e) => e.crossTime ?? 1);
    if (def.vehicle.capacity < 1) throw new PuzzleDefinitionError(`${def.id}: Kapazität muss ≥ 1 sein.`);
    if (def.vehicle.requirePilot && this.pilotMask === 0) {
      throw new PuzzleDefinitionError(`${def.id}: Pilot erforderlich, aber keine Figur kann steuern.`);
    }
    if (def.cost.type === 'slowest') {
      def.entities.forEach((e) => {
        if (typeof e.crossTime !== 'number' || e.crossTime <= 0) {
          throw new PuzzleDefinitionError(`${def.id}: Figur "${e.id}" braucht eine positive crossTime.`);
        }
      });
    }
    for (const sticky of def.vehicle.stickyPilots ?? []) {
      const i = this.index.get(sticky);
      if (i === undefined || !def.entities[i]!.canPilot) {
        throw new PuzzleDefinitionError(`${def.id}: stickyPilot "${sticky}" existiert nicht oder kann nicht steuern.`);
      }
    }

    // Start state
    let start = 0;
    const startSides = def.start?.entitySides ?? {};
    for (const [id, side] of Object.entries(startSides)) {
      const i = this.indexOf(id);
      if (side === 1) start |= 1 << i;
    }
    if ((def.start?.vehicleSide ?? 0) === 1) start |= this.vehicleBit;
    this.startState = start;

    this.goalSide = def.goal?.side ?? 1;
    this.goalMask = def.goal?.entities ? this.maskOf(def.goal.entities) : this.allMask;
    if (this.goalMask === 0) throw new PuzzleDefinitionError(`${def.id}: Ziel enthält keine Figuren.`);

    this.rules = def.rules.map((r) => this.compileRule(r));
  }

  // ───────────────────────────── helpers ─────────────────────────────

  indexOf(id: string): number {
    const i = this.index.get(id);
    if (i === undefined) throw new PuzzleDefinitionError(`${this.def.id}: unbekannte Figur "${id}".`);
    return i;
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  entity(id: string): EntityDef {
    return this.entities[this.indexOf(id)]!;
  }

  maskOf(ids: readonly string[]): number {
    let m = 0;
    for (const id of ids) m |= 1 << this.indexOf(id);
    return m;
  }

  idsOf(mask: number): string[] {
    return bitsOf(mask & this.allMask).map((i) => this.ids[i]!);
  }

  nom(i: number): string {
    return this.forms[i]!.nom;
  }
  acc(i: number): string {
    return this.forms[i]!.acc;
  }
  dat(i: number): string {
    return this.forms[i]!.dat;
  }

  namesOf(mask: number, form: keyof GrammarForms = 'nom'): string {
    return joinNames(bitsOf(mask & this.allMask).map((i) => this.forms[i]![form]));
  }

  private maskWhere(pred: (e: EntityDef) => boolean): number {
    let m = 0;
    this.def.entities.forEach((e, i) => {
      if (pred(e)) m |= 1 << i;
    });
    return m;
  }

  resolveSelector(sel: SelectorDef | undefined): number {
    if (!sel) return 0;
    let m = 0;
    if (sel.ids) m |= this.maskOf(sel.ids);
    if (sel.role) m |= this.maskWhere((e) => e.role === sel.role);
    if (sel.kind) m |= this.maskWhere((e) => e.kind === sel.kind);
    if (sel.tag) m |= this.maskWhere((e) => !!e.tags?.includes(sel.tag!));
    return m;
  }

  locationPhrase(loc: Location): string {
    return loc === 'vehicle' ? this.def.vehicleNames.at : this.def.sides[loc].at;
  }

  // ───────────────────────────── state access ─────────────────────────────

  vehicleSide(state: PuzzleState): Side {
    return (state & this.vehicleBit ? 1 : 0) as Side;
  }

  sideOf(state: PuzzleState, entityIndex: number): Side {
    return (state & (1 << entityIndex) ? 1 : 0) as Side;
  }

  /** Mask of entities standing on `side` (vehicle passengers count as being on the vehicle's side). */
  membersAt(state: PuzzleState, side: Side): number {
    return side === 1 ? state & this.allMask : ~state & this.allMask;
  }

  isGoal(state: PuzzleState): boolean {
    const onGoal = this.membersAt(state, this.goalSide);
    return (onGoal & this.goalMask) === this.goalMask;
  }

  weightOf(group: number): number {
    let w = 0;
    for (const i of bitsOf(group)) w += this.weights[i]!;
    return w;
  }

  crossingCost(group: number): number {
    if (this.def.cost.type === 'crossings') return 1;
    let t = 0;
    for (const i of bitsOf(group)) t = Math.max(t, this.times[i]!);
    return t;
  }

  // ───────────────────────────── rules ─────────────────────────────

  private compileRule(rule: RuleDef): CompiledRule {
    const onVehicle = rule.scope === 'banksAndVehicle';
    switch (rule.type) {
      case 'forbiddenTogether': {
        const aMask = this.resolveSelector(rule.a);
        const bMask = this.resolveSelector(rule.b);
        const supMask = this.resolveSelector(rule.unlessPresent);
        if (!aMask || !bMask) throw new PuzzleDefinitionError(`${this.def.id}: Regel ${rule.id} hat leere Selektoren.`);
        return {
          def: rule,
          onVehicle,
          check: (present, loc) => {
            const ap = present & aMask;
            const bp = present & bMask;
            if (!ap || !bp) return null;
            if (ap === bp && popcount(ap) === 1) return null; // same single entity
            if (present & supMask) return null;
            const aIdx = bitsOf(ap)[0]!;
            const bIdx = bitsOf(bp & ~(1 << aIdx))[0] ?? bitsOf(bp)[0]!;
            const guardIdx = bitsOf(supMask)[0];
            return {
              kind: 'rule',
              ruleId: rule.id,
              location: loc,
              entities: [this.ids[aIdx]!, this.ids[bIdx]!],
              title: rule.title,
              icon: rule.icon,
              message: capitalize(
                formatTemplate(rule.message, {
                  a: this.nom(aIdx),
                  b: this.nom(bIdx),
                  aAcc: this.acc(aIdx),
                  bAcc: this.acc(bIdx),
                  aDat: this.dat(aIdx),
                  bDat: this.dat(bIdx),
                  loc: this.locationPhrase(loc),
                  guard: guardIdx !== undefined ? this.nom(guardIdx) : '',
                }),
              ),
            };
          },
        };
      }
      case 'noOutnumber': {
        const pMask = this.resolveSelector(rule.protectedGroup);
        const tMask = this.resolveSelector(rule.threatGroup);
        if (!pMask || !tMask) throw new PuzzleDefinitionError(`${this.def.id}: Regel ${rule.id} hat leere Selektoren.`);
        return {
          def: rule,
          onVehicle,
          check: (present, loc) => {
            const p = present & pMask;
            const t = present & tMask;
            const pc = popcount(p);
            const tc = popcount(t);
            if (pc === 0 || tc <= pc) return null;
            return {
              kind: 'rule',
              ruleId: rule.id,
              location: loc,
              entities: [...this.idsOf(p), ...this.idsOf(t)],
              title: rule.title,
              icon: rule.icon,
              message: capitalize(
                formatTemplate(rule.message, {
                  loc: this.locationPhrase(loc),
                  threatCount: tc,
                  protectedCount: pc,
                  threatNames: this.namesOf(t),
                  protectedNames: this.namesOf(p),
                }),
              ),
            };
          },
        };
      }
      case 'pairGuard': {
        const wardMask = this.resolveSelector(rule.wards);
        const guardMask = this.resolveSelector(rule.guards);
        if (!wardMask || !guardMask) throw new PuzzleDefinitionError(`${this.def.id}: Regel ${rule.id} hat leere Selektoren.`);
        // own guard per ward
        const ownGuard = new Map<number, number>();
        for (const w of bitsOf(wardMask)) {
          const pid = this.entities[w]!.pairId;
          const g = bitsOf(guardMask).find((gi) => this.entities[gi]!.pairId === pid && pid !== undefined);
          if (g === undefined) throw new PuzzleDefinitionError(`${this.def.id}: ${this.ids[w]} hat keinen eigenen Captain.`);
          ownGuard.set(w, g);
        }
        return {
          def: rule,
          onVehicle,
          check: (present, loc) => {
            for (const w of bitsOf(present & wardMask)) {
              const own = ownGuard.get(w)!;
              const ownBit = 1 << own;
              const foreign = present & guardMask & ~ownBit;
              if (foreign && !(present & ownBit)) {
                return {
                  kind: 'rule',
                  ruleId: rule.id,
                  location: loc,
                  entities: [this.ids[w]!, ...this.idsOf(foreign), this.ids[own]!],
                  title: rule.title,
                  icon: rule.icon,
                  message: capitalize(
                    formatTemplate(rule.message, {
                      ward: this.nom(w),
                      foreign: this.namesOf(foreign, 'dat'),
                      foreignNom: this.namesOf(foreign, 'nom'),
                      own: this.nom(own),
                      ownAcc: this.acc(own),
                      loc: this.locationPhrase(loc),
                    }),
                  ),
                };
              }
            }
            return null;
          },
        };
      }
    }
  }

  /** Rule violations on both banks of a resting state. */
  validateState(state: PuzzleState): Violation[] {
    const out: Violation[] = [];
    for (const side of [0, 1] as Side[]) {
      const present = this.membersAt(state, side);
      for (const r of this.rules) {
        const v = r.check(present, side);
        if (v) out.push(v);
      }
    }
    return out;
  }

  isValidState(state: PuzzleState): boolean {
    for (const side of [0, 1] as Side[]) {
      const present = this.membersAt(state, side);
      for (const r of this.rules) if (r.check(present, side)) return false;
    }
    return true;
  }

  /** Constraints on the travelling group itself (independent of the banks). */
  checkGroup(state: PuzzleState, group: number): Violation[] {
    const vn = this.def.vehicleNames;
    const vSide = this.vehicleSide(state);
    const out: Violation[] = [];
    if (group === 0) {
      out.push({
        kind: 'empty',
        entities: [],
        title: 'Niemand an Bord',
        message: `${capitalize(vn.nom)} kann nicht leer fahren – jemand muss steuern.`,
        icon: 'helm',
      });
      return out;
    }
    const wrongSide = group & ~this.membersAt(state, vSide) & this.allMask;
    if (wrongSide) {
      out.push({
        kind: 'notAtVehicle',
        entities: this.idsOf(wrongSide),
        title: 'Falsches Ufer',
        message: `${capitalize(this.namesOf(wrongSide))} ${popcount(wrongSide) > 1 ? 'stehen' : 'steht'} nicht auf der Seite, an der ${vn.nom} liegt.`,
        icon: 'shore',
      });
    }
    const count = popcount(group);
    if (count > this.def.vehicle.capacity) {
      out.push({
        kind: 'capacity',
        entities: this.idsOf(group),
        title: 'Zu viele an Bord',
        message: `${capitalize(vn.nom)} trägt höchstens ${this.def.vehicle.capacity} ${this.def.vehicle.capacity === 1 ? 'Figur' : 'Figuren'}.`,
        icon: 'capacity',
      });
    }
    const maxW = this.def.vehicle.maxWeight;
    if (maxW !== undefined) {
      const w = this.weightOf(group);
      if (w > maxW) {
        out.push({
          kind: 'weight',
          entities: this.idsOf(group),
          title: 'Zu schwer',
          message: `${capitalize(vn.nom)} trägt maximal ${maxW} kg – ${this.namesOf(group)} ${count > 1 ? 'wiegen' : 'wiegt'} zusammen ${w} kg.`,
          icon: 'weight',
        });
      }
    }
    if (this.def.vehicle.requirePilot && !(group & this.pilotMask)) {
      out.push({
        kind: 'noPilot',
        entities: this.idsOf(group),
        title: 'Niemand steuert',
        message: `${capitalize(this.namesOf(group))} ${count > 1 ? 'können' : 'kann'} ${vn.acc} nicht steuern. Steuern ${popcount(this.pilotMask) > 1 ? 'können' : 'kann'}: ${this.namesOf(this.pilotMask)}.`,
        icon: 'helm',
      });
    }
    for (const r of this.rules) {
      if (!r.onVehicle) continue;
      const v = r.check(group, 'vehicle');
      if (v) out.push(v);
    }
    return out;
  }

  /** New state after `group` travels with the vehicle to the other side (no validation). */
  applyCrossing(state: PuzzleState, group: number): PuzzleState {
    return (state ^ group ^ this.vehicleBit) >>> 0;
  }

  /** Full legality check of a crossing: group constraints + both resulting banks. */
  tryCrossing(state: PuzzleState, group: number): {
    ok: boolean;
    violations: Violation[];
    next: PuzzleState;
    cost: number;
  } {
    const groupViolations = this.checkGroup(state, group);
    const next = this.applyCrossing(state, group);
    const cost = this.crossingCost(group);
    if (groupViolations.length) return { ok: false, violations: groupViolations, next, cost };
    const stateViolations = this.validateState(next);
    return { ok: stateViolations.length === 0, violations: stateViolations, next, cost };
  }

  /** All legal crossings from `state` in a deterministic order (small groups first, then by index). */
  legalActions(state: PuzzleState): CrossingAction[] {
    const vSide = this.vehicleSide(state);
    const available = this.membersAt(state, vSide);
    const to = (1 - vSide) as Side;
    const out: CrossingAction[] = [];
    // enumerate non-empty submasks of `available`
    const subs: number[] = [];
    for (let sub = available; sub; sub = (sub - 1) & available) subs.push(sub);
    subs.sort((a, b) => popcount(a) - popcount(b) || a - b);
    for (const g of subs) {
      if (popcount(g) > this.def.vehicle.capacity) continue;
      const r = this.tryCrossing(state, g);
      if (r.ok) out.push({ group: g, to, cost: r.cost });
    }
    return out;
  }

  describeGroup(group: number): string {
    return this.namesOf(group);
  }

  describeAction(a: CrossingAction): string {
    return `${capitalize(this.namesOf(a.group))} → ${this.def.sides[a.to].name}`;
  }
}
