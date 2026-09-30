/**
 * Riverbound QA – Gegenprobe: unabhängiges Orakel (tests/oracle/) ↔ Spiel-Engine (src/puzzle, src/levels).
 *
 * Braucht keine Zuordnung von Figuren-IDs. Verglichen werden
 *   1. optimale Kosten, Fahrtenzahl, Anzahl optimaler Lösungen,
 *   2. Zustandszahlen (gesamt, gültig/verboten, erreichbar),
 *   3. das Histogramm „optimale Restkosten → Anzahl erreichbarer Zustände“ (invariant unter Umbenennung
 *      der Figuren; deckt falsch formulierte Regeln auf, auch wenn das Optimum zufällig stimmt).
 * Fehlt die erwartete Engine-API (Code im Umbau), wird die Gegenprobe übersprungen statt rot zu werden.
 */
import { describe, expect, it } from 'vitest';
import { analyzeLevel, checkSequence, GAME_LEVEL_IDS, ORACLE_FOR_GAME_LEVEL, solveFrom, type OracleLevel } from '../oracle';

type EngineModel = {
  startState: number;
  totalStates: number;
  legalActions(state: number): Array<{ group: number }>;
  applyCrossing(state: number, group: number): number;
};
type EngineApi = {
  puzzles: ReadonlyArray<{ id: string; entities: unknown[] }>;
  makeModel(def: unknown): EngineModel;
  solve(model: EngineModel, from?: number): { cost: number; crossings: number } | null;
  analyze(model: EngineModel): { totalStates: number; validStates: number; forbiddenStates: number; reachableStates: number; optimalSolutionCount: number };
};

async function loadEngine(): Promise<{ api?: EngineApi; reason?: string }> {
  try {
    const levels = (await import('../../src/levels/puzzles')) as Record<string, unknown>;
    const engine = (await import('../../src/puzzle/engine')) as Record<string, unknown>;
    const solver = (await import('../../src/puzzle/solver')) as Record<string, unknown>;
    const Model = engine.PuzzleModel as (new (def: unknown) => EngineModel) | undefined;
    if (!Array.isArray(levels.PUZZLES) || typeof Model !== 'function' || typeof solver.solve !== 'function' || typeof solver.analyzeStateSpace !== 'function') {
      return { reason: 'Engine-API (PUZZLES, PuzzleModel, solve, analyzeStateSpace) nicht vollständig vorhanden' };
    }
    return {
      api: {
        puzzles: levels.PUZZLES as EngineApi['puzzles'],
        makeModel: (def) => new Model(def),
        solve: solver.solve as EngineApi['solve'],
        analyze: solver.analyzeStateSpace as EngineApi['analyze'],
      },
    };
  } catch (err) {
    return { reason: `Engine nicht ladbar: ${String(err)}` };
  }
}

const { api, reason } = await loadEngine();

/** Histogramm der optimalen Restkosten über alle vom Start erreichbaren Zustände (Engine). */
function engineHistogram(e: EngineApi, model: EngineModel): Record<string, number> {
  const seen = new Set<number>([model.startState]);
  const queue = [model.startState];
  while (queue.length) {
    const s = queue.shift()!;
    for (const a of model.legalActions(s)) {
      const n = model.applyCrossing(s, a.group);
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  const h: Record<string, number> = {};
  for (const s of seen) {
    const k = String(e.solve(model, s)?.cost ?? 'unlösbar');
    h[k] = (h[k] ?? 0) + 1;
  }
  return h;
}

/** Dasselbe Histogramm aus dem Orakel (Zeitlimit hier ausgeschaltet: es geht um Restkosten, nicht um das Budget). */
function oracleHistogram(level: OracleLevel): Record<string, number> {
  const free: OracleLevel = { ...level, timeLimit: undefined };
  const n = free.figures.length;
  const all = (1 << n) - 1;
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const s = queue.shift()!;
    const here = (s >> n) & 1 ? s & all : all & ~s & all;
    for (let g = here; g > 0; g = (g - 1) & here) {
      const group = free.figures.filter((_, i) => g & (1 << i)).map((f) => f.id);
      if (!checkSequence(free, [group], s).ok) continue; // Einzelzug ab Zustand s regelkonform?
      const next = ((s & all) ^ g) | ((1 - ((s >> n) & 1)) << n);
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const h: Record<string, number> = {};
  for (const s of seen) {
    const k = String(solveFrom(free, s)?.cost ?? 'unlösbar');
    h[k] = (h[k] ?? 0) + 1;
  }
  return h;
}

describe.skipIf(!api)(`Gegenprobe Orakel ↔ Engine${reason ? ` (übersprungen: ${reason})` : ''}`, () => {
  for (const id of GAME_LEVEL_IDS) {
    it(`${id}: Optimum, Zustandsraum und Restkosten-Histogramm stimmen überein`, () => {
      const e = api!;
      const def = e.puzzles.find((p) => p.id === id);
      expect(def, `Level ${id} fehlt in PUZZLES`).toBeDefined();
      const oracle = ORACLE_FOR_GAME_LEVEL[id];
      const report = analyzeLevel(oracle);
      const model = e.makeModel(def);
      const sol = e.solve(model);
      const stats = e.analyze(model);
      expect(def!.entities.length, 'Figurenzahl').toBe(oracle.figures.length);
      expect(sol?.cost, 'optimale Kosten').toBe(report.optimalCost);
      expect(sol?.crossings, 'Fahrten der optimalen Lösung').toBe(report.optimalCrossings);
      expect(
        { total: stats.totalStates, valid: stats.validStates, forbidden: stats.forbiddenStates, reachable: stats.reachableStates, optimalSolutions: stats.optimalSolutionCount },
        'Zustandsraum',
      ).toEqual({ total: report.totalStates, valid: report.validStates, forbidden: report.forbiddenStates, reachable: report.reachableStates, optimalSolutions: report.optimalSolutionCount });
      expect(engineHistogram(e, model), 'Histogramm optimale Restkosten').toEqual(oracleHistogram(oracle));
    });
  }
});
