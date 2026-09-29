import { PuzzleDefinitionError, PuzzleModel } from './engine';
import { analyzeStateSpace, solve, type Solution, type StateSpaceStats } from './solver';
import type { PuzzleDefinition, Violation } from './types';

export interface LevelValidationReport {
  levelId: string;
  /** true only if every check passed – otherwise the level must not be offered as playable. */
  ok: boolean;
  errors: string[];
  /** 1. start state valid? */
  startValid: boolean;
  startViolations: Violation[];
  /** 2. goal defined (and itself a valid resting state)? */
  goalDefined: boolean;
  /** 3. at least one solution? */
  solvable: boolean;
  /** 4. optimal solution under the level metric */
  optimal: Solution | null;
  metric: 'crossings' | 'time';
  timeLimit: number | null;
  /** 5. number of states */
  stats: StateSpaceStats | null;
  /** 6. legal actions from the start state (human readable) */
  legalStartActions: string[];
  /** 7. forbidden states = stats.forbiddenStates; examples for documentation */
  forbiddenExamples: string[];
  model: PuzzleModel | null;
}

export function validateLevel(def: PuzzleDefinition): LevelValidationReport {
  const report: LevelValidationReport = {
    levelId: def.id,
    ok: false,
    errors: [],
    startValid: false,
    startViolations: [],
    goalDefined: false,
    solvable: false,
    optimal: null,
    metric: def.cost.type === 'slowest' ? 'time' : 'crossings',
    timeLimit: def.cost.type === 'slowest' ? (def.cost.limit ?? null) : null,
    stats: null,
    legalStartActions: [],
    forbiddenExamples: [],
    model: null,
  };

  let model: PuzzleModel;
  try {
    model = new PuzzleModel(def);
  } catch (e) {
    report.errors.push(e instanceof PuzzleDefinitionError ? e.message : `Unerwarteter Fehler: ${String(e)}`);
    return report;
  }
  report.model = model;

  // 1. start state
  report.startViolations = model.validateState(model.startState);
  report.startValid = report.startViolations.length === 0;
  if (!report.startValid) {
    report.errors.push(`Startzustand ungültig: ${report.startViolations.map((v) => v.message).join(' | ')}`);
  }
  if (model.isGoal(model.startState)) report.errors.push('Startzustand erfüllt bereits das Ziel.');

  // 2. goal – there must be at least one valid resting state that satisfies the goal
  let goalStateExists = false;
  for (let s = 0; s < model.totalStates; s++) {
    if (model.isGoal(s) && model.isValidState(s)) {
      goalStateExists = true;
      break;
    }
  }
  report.goalDefined = model.goalMask !== 0 && goalStateExists;
  if (!report.goalDefined) report.errors.push('Kein gültiger Zielzustand definierbar.');

  // 5./7. state space
  report.stats = analyzeStateSpace(model);
  let examples = 0;
  for (let s = 0; s < model.totalStates && examples < 3; s++) {
    const v = model.validateState(s);
    if (v.length) {
      report.forbiddenExamples.push(v[0]!.message);
      examples++;
    }
  }

  // 6. legal actions from start
  report.legalStartActions = model.legalActions(model.startState).map((a) => model.describeAction(a));
  if (report.startValid && report.legalStartActions.length === 0) {
    report.errors.push('Im Startzustand ist keine einzige Überfahrt erlaubt.');
  }

  // 3./4. solvability + optimum
  if (report.startValid) {
    report.optimal = solve(model);
    report.solvable = report.optimal !== null;
    if (!report.solvable) report.errors.push('Level ist nicht lösbar.');
    if (report.optimal && report.timeLimit !== null && report.optimal.cost > report.timeLimit) {
      report.solvable = false;
      report.errors.push(
        `Optimale Lösung (${report.optimal.cost}) überschreitet das Zeitlimit (${report.timeLimit}).`,
      );
    }
  }

  report.ok = report.errors.length === 0;
  return report;
}

/** Compact multi-line text for logs / the debug panel. */
export function formatReport(r: LevelValidationReport): string {
  const lines = [
    `Level ${r.levelId}: ${r.ok ? 'OK' : 'FEHLER'}`,
    `  Start gültig: ${r.startValid}  Ziel definiert: ${r.goalDefined}  lösbar: ${r.solvable}`,
  ];
  if (r.optimal) {
    lines.push(
      `  Optimum: ${r.optimal.cost} ${r.metric === 'time' ? 'Min' : 'Überfahrten'} in ${r.optimal.crossings} Überfahrten`,
    );
    if (r.model) {
      r.optimal.actions.forEach((a, i) => lines.push(`    ${i + 1}. ${r.model!.describeAction(a)} (+${a.cost})`));
    }
  }
  if (r.stats) {
    lines.push(
      `  Zustände: ${r.stats.totalStates} gesamt, ${r.stats.validStates} gültig, ${r.stats.forbiddenStates} verboten, ${r.stats.reachableStates} erreichbar, ${r.stats.optimalSolutionCount} optimale Lösungen`,
    );
  }
  lines.push(`  Legale Startaktionen: ${r.legalStartActions.join('; ')}`);
  for (const e of r.errors) lines.push(`  ! ${e}`);
  return lines.join('\n');
}
