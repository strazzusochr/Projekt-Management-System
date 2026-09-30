/**
 * Riverbound QA – unabhängiges Rätsel-Orakel (Kern).
 *
 * Bewusst OHNE Imports aus `src/`: Regeln werden pro Level direkt aus docs/REQUIREMENTS.md als
 * einfache Prädikate formuliert (tests/oracle/levels.ts), die Suche ist eine eigene Implementierung.
 * Damit lässt sich die Spiel-Engine gegenprüfen, ohne ihre Denkfehler zu übernehmen.
 *
 * Zustandsmodell:
 *   - `mask`: Bit i = 1 ⇔ Figur i steht am Zielufer ("right"), sonst am Startufer ("left").
 *   - `boat`: 0 = Boot am Startufer, 1 = Boot am Zielufer.
 *   - Zustandsschlüssel = mask | (boat << n) → genau 2^(n+1) Konfigurationen.
 * Aktion = Gruppe (Bitmaske) von Figuren, die zusammen mit dem Boot die Seite wechseln.
 * Nach jeder Überfahrt werden BEIDE Ufer geprüft (die Ankommenden zählen zum Ankunftsufer).
 */

export type BankSide = 'left' | 'right';

export interface OracleFigure {
  /** Orakel-eigene ID (unabhängig von den IDs im Spiel). */
  id: string;
  /** Darf das Boot/die Plattform steuern. */
  pilot: boolean;
  /** Gewicht in kg (nur für Level mit Gewichtsgrenze). */
  weight?: number;
  /** Überfahrtzeit in Minuten (nur für Level mit Zeitmetrik). */
  minutes?: number;
}

export interface OracleLevel {
  id: string;
  title: string;
  figures: readonly OracleFigure[];
  /** Maximale Anzahl Figuren an Bord (inklusive Pilot). */
  maxAboard: number;
  /** Maximale Zuladung in kg (optional). */
  maxWeight?: number;
  /** 'crossings': jede Überfahrt kostet 1. 'time': Kosten = langsamste Figur der Gruppe. */
  metric: 'crossings' | 'time';
  /** Zeitbudget (nur metric = 'time'); Überfahrten, die es überschreiten würden, sind unzulässig. */
  timeLimit?: number;
  /**
   * Regel für eine Menge von Figuren, die gemeinsam an EINEM Ufer stehen.
   * Liefert eine Begründung, wenn die Konstellation verboten ist, sonst null.
   */
  bankViolation(present: ReadonlySet<string>): string | null;
  /** Optional: dieselbe Art Prüfung für die Besatzung während der Überfahrt. */
  boatViolation?(aboard: ReadonlySet<string>): string | null;
}

export interface OracleStep {
  /** Figuren-IDs der Gruppe, die übersetzt. */
  group: string[];
  /** Zielseite dieser Überfahrt. */
  to: BankSide;
  /** Kosten dieser Überfahrt in der Levelmetrik. */
  cost: number;
  /** Aufsummierte Kosten nach dieser Überfahrt. */
  total: number;
}

export interface OracleReport {
  id: string;
  title: string;
  metric: 'crossings' | 'time';
  figures: number;
  /** Optimale Kosten in der Levelmetrik (Überfahrten bzw. Minuten); null = unlösbar. */
  optimalCost: number | null;
  /** Anzahl Überfahrten der optimalen Lösung (bei Zeitmetrik: minimale Fahrtenzahl unter allen zeitoptimalen). */
  optimalCrossings: number | null;
  /** Anzahl verschiedener optimaler Zugfolgen (lexikografisch: Kosten, dann Fahrten). */
  optimalSolutionCount: number;
  /** Eine optimale Zugfolge. */
  sequence: OracleStep[];
  /** 2^(n+1): alle Konfigurationen aus Figurenseiten × Bootseite. */
  totalStates: number;
  /** Konfigurationen, in denen kein Ufer eine Regel verletzt. */
  validStates: number;
  /** Konfigurationen, in denen mindestens ein Ufer eine Regel verletzt. */
  forbiddenStates: number;
  /** Vom Start aus über regelkonforme Überfahrten erreichbare Zustände (inkl. Start, ohne Zeitlimit). */
  reachableStates: number;
  /** Anzahl regelkonformer Übergänge zwischen erreichbaren Zuständen. */
  reachableTransitions: number;
  /** Verschiedene verbotene Zustände, die ein einzelner Zug aus einem erreichbaren Zustand erzeugen würde. */
  forbiddenSuccessorStates: number;
  /** Nur Zeitmetrik: erreichbare Zustände, deren kürzeste Zeit das Limit einhält. */
  reachableWithinLimit?: number;
}

export interface OracleSolution {
  cost: number;
  crossings: number;
  steps: OracleStep[];
}

export interface SequenceCheck {
  ok: boolean;
  cost: number;
  crossings: number;
  /** Erster Fehler (z.B. Regelverstoß, falsche Seite, Kapazität). */
  error?: string;
  /** Index der fehlerhaften Aktion. */
  failedAt?: number;
  reachedGoal: boolean;
}

// ---------------------------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------------------------

export function bitCount(x: number): number {
  let c = 0;
  for (let v = x; v; v &= v - 1) c++;
  return c;
}

function idsOf(level: OracleLevel, mask: number): string[] {
  const out: string[] = [];
  level.figures.forEach((f, i) => {
    if (mask & (1 << i)) out.push(f.id);
  });
  return out;
}

function setOf(level: OracleLevel, mask: number): Set<string> {
  return new Set(idsOf(level, mask));
}

function maskOf(level: OracleLevel, ids: readonly string[]): number {
  let m = 0;
  for (const id of ids) {
    const i = level.figures.findIndex((f) => f.id === id);
    if (i < 0) throw new Error(`${level.id}: unbekannte Figur "${id}"`);
    m |= 1 << i;
  }
  return m;
}

/** Verletzt die Konfiguration (Figurenmaske, egal welche Bootseite) eine Uferregel? */
export function bankProblem(level: OracleLevel, mask: number): string | null {
  const all = (1 << level.figures.length) - 1;
  const right = level.bankViolation(setOf(level, mask));
  if (right) return `Zielufer: ${right}`;
  const left = level.bankViolation(setOf(level, all & ~mask));
  if (left) return `Startufer: ${left}`;
  return null;
}

/** Prüft eine einzelne Gruppe für eine Überfahrt (ohne Uferprüfung). */
export function groupProblem(level: OracleLevel, group: number): string | null {
  const n = bitCount(group);
  if (n === 0) return 'Das Boot darf nicht leer fahren.';
  if (n > level.maxAboard) return `Zu viele Figuren an Bord (${n} > ${level.maxAboard}).`;
  let weight = 0;
  let pilot = false;
  level.figures.forEach((f, i) => {
    if (group & (1 << i)) {
      weight += f.weight ?? 0;
      pilot ||= f.pilot;
    }
  });
  if (!pilot) return 'Niemand an Bord kann steuern.';
  if (level.maxWeight !== undefined && weight > level.maxWeight) return `Zu schwer (${weight} kg > ${level.maxWeight} kg).`;
  if (level.boatViolation) {
    const v = level.boatViolation(setOf(level, group));
    if (v) return `Im Boot: ${v}`;
  }
  return null;
}

function stepCost(level: OracleLevel, group: number): number {
  if (level.metric === 'crossings') return 1;
  let max = 0;
  level.figures.forEach((f, i) => {
    if (group & (1 << i)) max = Math.max(max, f.minutes ?? 0);
  });
  return max;
}

interface Move {
  group: number;
  next: number; // Zustandsschlüssel
  cost: number;
}

/** Alle Züge aus einem Zustand – getrennt nach regelkonform und (nur Ufer-)verboten. */
function movesFrom(level: OracleLevel, state: number): { legal: Move[]; forbiddenTargets: number[] } {
  const n = level.figures.length;
  const all = (1 << n) - 1;
  const mask = state & all;
  const boat = (state >> n) & 1;
  // Figuren auf der Bootseite
  const here = boat === 1 ? mask : all & ~mask;
  const legal: Move[] = [];
  const forbiddenTargets: number[] = [];
  // alle nicht-leeren Teilmengen von `here`
  for (let g = here; g > 0; g = (g - 1) & here) {
    if (groupProblem(level, g)) continue;
    const nextMask = mask ^ g;
    const next = nextMask | ((1 - boat) << n);
    if (bankProblem(level, nextMask)) {
      forbiddenTargets.push(next);
      continue;
    }
    legal.push({ group: g, next, cost: stepCost(level, g) });
  }
  // deterministische Reihenfolge: kleinere Gruppen zuerst, dann Bitmuster
  legal.sort((a, b) => bitCount(a.group) - bitCount(b.group) || a.group - b.group);
  return { legal, forbiddenTargets };
}

function startKey(): number {
  return 0; // alle links, Boot links
}

function goalKey(level: OracleLevel): number {
  const n = level.figures.length;
  return ((1 << n) - 1) | (1 << n);
}

/** Zustandsschlüssel aus Figurenseiten (IDs des Orakels) + Bootseite. */
export function stateFrom(level: OracleLevel, rightIds: readonly string[], boat: BankSide): number {
  return maskOf(level, rightIds) | ((boat === 'right' ? 1 : 0) << level.figures.length);
}

// ---------------------------------------------------------------------------------------------
// Suche
// ---------------------------------------------------------------------------------------------

/** Binärer Min-Heap nach (Kosten, Fahrten, Einfügereihenfolge) – deterministisch. */
class Heap {
  private a: Array<[number, number, number, number]> = []; // [cost, crossings, seq, state]
  get size(): number {
    return this.a.length;
  }
  private lt(i: number, j: number): boolean {
    const x = this.a[i];
    const y = this.a[j];
    return x[0] !== y[0] ? x[0] < y[0] : x[1] !== y[1] ? x[1] < y[1] : x[2] < y[2];
  }
  push(v: [number, number, number, number]): void {
    this.a.push(v);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.lt(i, p)) break;
      [this.a[i], this.a[p]] = [this.a[p], this.a[i]];
      i = p;
    }
  }
  pop(): [number, number, number, number] {
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.a.length && this.lt(l, m)) m = l;
        if (r < this.a.length && this.lt(r, m)) m = r;
        if (m === i) break;
        [this.a[i], this.a[m]] = [this.a[m], this.a[i]];
        i = m;
      }
    }
    return top;
  }
}

interface DijkstraResult {
  /** kombinierter Schlüssel cost * 1000 + crossings */
  dist: Map<number, number>;
  parent: Map<number, { prev: number; group: number; cost: number }>;
  ways: Map<number, number>;
}

const K = 1000; // Fahrten pro Kostenstufe (reichlich für alle Level)

function dijkstra(level: OracleLevel, from: number): DijkstraResult {
  const dist = new Map<number, number>([[from, 0]]);
  const parent = new Map<number, { prev: number; group: number; cost: number }>();
  const ways = new Map<number, number>([[from, 1]]);
  const done = new Set<number>();
  const heap = new Heap();
  let seq = 0;
  heap.push([0, 0, seq++, from]);
  while (heap.size) {
    const [c, f, , s] = heap.pop();
    if (done.has(s)) continue;
    done.add(s);
    for (const mv of movesFrom(level, s).legal) {
      const nc = c + mv.cost;
      if (level.timeLimit !== undefined && level.metric === 'time' && nc > level.timeLimit) continue;
      const key = nc * K + (f + 1);
      const known = dist.get(mv.next);
      if (known === undefined || key < known) {
        dist.set(mv.next, key);
        parent.set(mv.next, { prev: s, group: mv.group, cost: mv.cost });
        ways.set(mv.next, ways.get(s)!);
        heap.push([nc, f + 1, seq++, mv.next]);
      } else if (key === known && !done.has(mv.next)) {
        ways.set(mv.next, ways.get(mv.next)! + ways.get(s)!);
      }
    }
  }
  return { dist, parent, ways };
}

/** Optimale Lösung ab `from` (Default: Start). null, wenn unlösbar (bzw. nicht im Zeitlimit). */
export function solveFrom(level: OracleLevel, from: number = startKey()): OracleSolution | null {
  if (bankProblem(level, from & ((1 << level.figures.length) - 1))) return null;
  const { dist, parent } = dijkstra(level, from);
  const goal = goalKey(level);
  const key = dist.get(goal);
  if (key === undefined) return null;
  const steps: OracleStep[] = [];
  let s = goal;
  while (s !== from) {
    const p = parent.get(s)!;
    const toRight = ((s >> level.figures.length) & 1) === 1;
    steps.push({ group: idsOf(level, p.group), to: toRight ? 'right' : 'left', cost: p.cost, total: 0 });
    s = p.prev;
  }
  steps.reverse();
  let total = 0;
  for (const st of steps) {
    total += st.cost;
    st.total = total;
  }
  return { cost: Math.floor(key / K), crossings: key % K, steps };
}

/** Vollständige Analyse eines Levels ab Startzustand. */
export function analyzeLevel(level: OracleLevel): OracleReport {
  const n = level.figures.length;
  const all = (1 << n) - 1;
  const totalStates = 1 << (n + 1);
  let forbidden = 0;
  for (let s = 0; s < totalStates; s++) if (bankProblem(level, s & all)) forbidden++;

  // Erreichbarkeit (BFS, ohne Zeitlimit – das Limit ist eine Pfad-, keine Zustandseigenschaft)
  const start = startKey();
  const seen = new Set<number>([start]);
  const queue = [start];
  const forbiddenHit = new Set<number>();
  let transitions = 0;
  while (queue.length) {
    const s = queue.shift()!;
    const { legal, forbiddenTargets } = movesFrom(level, s);
    forbiddenTargets.forEach((t) => forbiddenHit.add(t));
    for (const mv of legal) {
      transitions++;
      if (!seen.has(mv.next)) {
        seen.add(mv.next);
        queue.push(mv.next);
      }
    }
  }

  const { dist, ways } = dijkstra(level, start);
  const sol = solveFrom(level, start);
  const report: OracleReport = {
    id: level.id,
    title: level.title,
    metric: level.metric,
    figures: n,
    optimalCost: sol?.cost ?? null,
    optimalCrossings: sol?.crossings ?? null,
    optimalSolutionCount: sol ? ways.get(goalKey(level)) ?? 0 : 0,
    sequence: sol?.steps ?? [],
    totalStates,
    validStates: totalStates - forbidden,
    forbiddenStates: forbidden,
    reachableStates: seen.size,
    reachableTransitions: transitions,
    forbiddenSuccessorStates: forbiddenHit.size,
  };
  if (level.metric === 'time' && level.timeLimit !== undefined) report.reachableWithinLimit = dist.size;
  return report;
}

/**
 * Prüft eine Zugfolge (Liste von Gruppen aus Orakel-IDs) regelgerecht ab `from`.
 * Nützlich, um vom Spiel gelieferte Lösungen nachzurechnen.
 */
export function checkSequence(level: OracleLevel, groups: readonly (readonly string[])[], from: number = startKey()): SequenceCheck {
  const n = level.figures.length;
  const all = (1 << n) - 1;
  let s = from;
  let cost = 0;
  for (let i = 0; i < groups.length; i++) {
    let g: number;
    try {
      g = maskOf(level, groups[i]);
    } catch (e) {
      return { ok: false, cost, crossings: i, error: String(e), failedAt: i, reachedGoal: false };
    }
    const boat = (s >> n) & 1;
    const mask = s & all;
    const here = boat === 1 ? mask : all & ~mask;
    if ((g & here) !== g) return { ok: false, cost, crossings: i, error: 'Figur steht nicht auf der Bootseite.', failedAt: i, reachedGoal: false };
    const gp = groupProblem(level, g);
    if (gp) return { ok: false, cost, crossings: i, error: gp, failedAt: i, reachedGoal: false };
    const nextMask = mask ^ g;
    const bp = bankProblem(level, nextMask);
    if (bp) return { ok: false, cost, crossings: i, error: bp, failedAt: i, reachedGoal: false };
    cost += stepCost(level, g);
    if (level.metric === 'time' && level.timeLimit !== undefined && cost > level.timeLimit) {
      return { ok: false, cost, crossings: i + 1, error: `Zeitlimit überschritten (${cost} > ${level.timeLimit}).`, failedAt: i, reachedGoal: false };
    }
    s = nextMask | ((1 - boat) << n);
  }
  return { ok: true, cost, crossings: groups.length, reachedGoal: s === goalKey(level) };
}
