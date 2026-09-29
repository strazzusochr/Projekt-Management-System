import { bitsOf, capitalize, joinNames, popcount, PuzzleModel, type PuzzleState } from './engine';
import { solve, type Solution } from './solver';
import type { CrossingAction } from './types';

/**
 * Three-stage hint system. Every hint is derived at call time from an exact search from the
 * *current* state plus an analysis of the rules – there are no stored per-state texts.
 *
 *  1 – general: a strategic insight detected in the optimal remaining path / the rule that
 *      currently blocks most crossings, plus progress figures.
 *  2 – next sensible action: direction and an abstract description of the next group
 *      (roles, speed rank, weight class) without naming individuals.
 *  3 – concrete next action: exact group, what to load/unload, destination; entities highlighted.
 */

export type HintLevel = 1 | 2 | 3;

export interface Hint {
  level: HintLevel;
  title: string;
  text: string;
  /** Entities to highlight in the world. */
  focus: string[];
  /** Next optimal crossing (only exposed for level 3). */
  action: CrossingAction | null;
  /** Minimal remaining cost from the current state (null if unsolvable). */
  remainingCost: number | null;
  /** Time-limited level can no longer be finished within the limit. */
  doomed: boolean;
  /** Number of crossings to undo to get back on a feasible track (0 = none). */
  undoSuggested: number;
}

export interface HintContext {
  state: PuzzleState;
  /** Entities currently staged aboard (bitmask). */
  load: number;
  /** Cost already spent (metric units). */
  elapsed: number;
  /** Crossing history: state before each crossing and its cost. */
  history: ReadonlyArray<{ before: PuzzleState; cost: number }>;
}

const NUMBER_WORDS = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'];

function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function metricUnit(model: PuzzleModel, n: number): string {
  if (model.def.cost.type === 'slowest') return `${n} ${model.def.cost.unit}`;
  return n === 1 ? '1 Überfahrt' : `${n} Überfahrten`;
}

function isBackward(model: PuzzleModel, a: CrossingAction): boolean {
  return a.to !== model.goalSide;
}

function directionPhrase(model: PuzzleModel, a: CrossingAction): string {
  const to = model.def.sides[a.to].to;
  return isBackward(model, a) ? `zurück ${to}` : to;
}

function stickyMask(model: PuzzleModel): number {
  return model.maskOf(model.def.vehicle.stickyPilots ?? []);
}

/** Legal actions from `state` that keep the optimal remaining cost. */
function optimalFirstMoves(model: PuzzleModel, state: PuzzleState, best: Solution): CrossingAction[] {
  const out: CrossingAction[] = [];
  for (const a of model.legalActions(state)) {
    const rest = solve(model, model.applyCrossing(state, a.group));
    if (rest && a.cost + rest.cost === best.cost) out.push(a);
  }
  return out;
}

/** For each rule: how many capacity-feasible groups from `state` it currently blocks. */
function ruleTension(model: PuzzleModel, state: PuzzleState): Map<string, number> {
  const tension = new Map<string, number>();
  const side = model.vehicleSide(state);
  const available = model.membersAt(state, side);
  for (let g = available; g; g = (g - 1) & available) {
    const groupProblems = model.checkGroup(state, g).filter((v) => v.kind !== 'rule');
    if (groupProblems.length) continue;
    const r = model.tryCrossing(state, g);
    if (r.ok) continue;
    const seen = new Set<string>();
    for (const v of r.violations) {
      if (v.kind === 'rule' && v.ruleId && !seen.has(v.ruleId)) {
        seen.add(v.ruleId);
        tension.set(v.ruleId, (tension.get(v.ruleId) ?? 0) + 1);
      }
    }
  }
  return tension;
}

/** Abstract description of a group for hint level 2. */
export function characterizeGroup(model: PuzzleModel, state: PuzzleState, group: number): string {
  const members = bitsOf(group);
  const sticky = stickyMask(model);
  const named = members.filter((i) => sticky & (1 << i)).map((i) => model.nom(i));
  const rest = members.filter((i) => !(sticky & (1 << i)));

  // Time levels: describe by speed rank among those waiting on the vehicle's side.
  if (model.def.cost.type === 'slowest') {
    const side = model.vehicleSide(state);
    const waiting = bitsOf(model.membersAt(state, side)).sort((a, b) => model.times[a]! - model.times[b]!);
    const ranks = rest.map((i) => waiting.indexOf(i)).sort((a, b) => a - b);
    const last = waiting.length - 1;
    let text: string;
    if (ranks.length === 1) {
      text = ranks[0] === 0 ? 'die schnellste Person auf dieser Seite' : ranks[0] === last ? 'die langsamste Person auf dieser Seite' : 'eine Person mittleren Tempos';
    } else if (ranks.length === 2 && ranks[0] === 0 && ranks[1] === 1) {
      text = 'die beiden Schnellsten auf dieser Seite';
    } else if (ranks.length === 2 && ranks[0] === last - 1 && ranks[1] === last) {
      text = 'die beiden Langsamsten auf dieser Seite';
    } else {
      text = 'eine schnelle und eine langsamere Person';
    }
    return joinNames([...named, text]);
  }

  // Couples in pair-guard levels.
  if (rest.length === 2) {
    const [a, b] = rest as [number, number];
    const pa = model.entities[a]!.pairId;
    if (pa && pa === model.entities[b]!.pairId) return joinNames([...named, 'ein zusammengehörendes Paar']);
  }

  const labels = model.def.roleLabels ?? {};
  const byRole = new Map<string, number>();
  for (const i of rest) {
    const role = model.entities[i]!.role ?? model.entities[i]!.kind;
    byRole.set(role, (byRole.get(role) ?? 0) + 1);
  }
  const parts: string[] = [...named];
  for (const [role, count] of byRole) {
    const l = labels[role];
    if (!l) {
      parts.push(model.namesOf(rest.filter((i) => (model.entities[i]!.role ?? model.entities[i]!.kind) === role).reduce((m, i) => m | (1 << i), 0)));
    } else {
      parts.push(count === 1 ? l.one : l.many.replace('{n}', numberWord(count)));
    }
  }
  if (named.length && rest.length === 0) return `${joinNames(named)} allein`;
  return joinNames(parts);
}

function generalInsight(model: PuzzleModel, ctx: HintContext, best: Solution): { title: string; text: string } {
  const window = best.actions.slice(0, 3);
  const sticky = stickyMask(model);
  /** Lower score = more relevant. Key insights get a bonus; later occurrences in the path a malus. */
  const insights: Array<{ title: string; text: string; score: number }> = [];
  const at = (pred: (a: CrossingAction) => boolean) => window.findIndex(pred);
  const KEY = 1.5;

  // Time metric: slowest pair travelling together / fast shuttles.
  if (model.def.cost.type === 'slowest') {
    const byTime = bitsOf(model.allMask).sort((a, b) => model.times[b]! - model.times[a]!);
    const slowPair = (1 << byTime[0]!) | (1 << byTime[1]!);
    const iSlow = at((a) => a.group === slowPair);
    if (iSlow >= 0) {
      insights.push({
        score: iSlow - KEY,
        title: 'Zeit bündeln',
        text: 'Eine gemeinsame Überfahrt dauert so lange wie die langsamere Person. Die beiden Langsamsten sollten ihre Zeit also gemeinsam verbrauchen – dann zählt sie nur einmal.',
      });
    }
    const iBack = at((a) => isBackward(model, a) && popcount(a.group) === 1);
    if (iBack >= 0) {
      insights.push({
        score: iBack,
        title: 'Rückfahrten sind teuer',
        text: `Jede Rückfahrt kostet Energie. Wer ${model.def.vehicleNames.acc} zurückbringt, sollte möglichst schnell sein.`,
      });
    }
  }

  // Weight metric: light entities pair up, heavy ones travel alone, non-pilots need company.
  const maxW = model.def.vehicle.maxWeight;
  if (maxW !== undefined) {
    const iLight = at((a) => popcount(a.group) >= 2 && model.weightOf(a.group) === maxW);
    if (iLight >= 0) {
      insights.push({
        score: iLight - KEY,
        title: 'Leichte als Pendler',
        text: `Zwei Leichte ergeben zusammen genau ${maxW} kg. Die Leichten sind deine Pendler: Sie können gemeinsam übersetzen, und einer von ihnen bringt ${model.def.vehicleNames.acc} zurück.`,
      });
    }
    const iHeavy = at((a) => popcount(a.group) === 1 && model.weightOf(a.group) === maxW);
    if (iHeavy >= 0) {
      insights.push({
        score: iHeavy,
        title: 'Schwere fahren allein',
        text: `Wer ${maxW} kg wiegt, füllt ${model.def.vehicleNames.acc} allein aus. Danach muss jemand Leichtes ${model.def.vehicleNames.acc} zurückbringen – sorge dafür, dass drüben schon jemand Leichtes wartet.`,
      });
    }
    const iPassenger = at((a) => (a.group & ~model.pilotMask) !== 0);
    if (iPassenger >= 0) {
      const passenger = bitsOf(window[iPassenger]!.group & ~model.pilotMask)[0]!;
      insights.push({
        score: iPassenger - KEY / 2,
        title: 'Wer nicht steuern kann',
        text: `${capitalize(model.nom(passenger))} kann nicht selbst steuern und braucht Begleitung – und zusammen dürfen beide höchstens ${maxW} kg wiegen.`,
      });
    }
  }

  // Bringing someone back.
  const iCarry = at(
    (a) => isBackward(model, a) && popcount(a.group & ~sticky) >= 1 && (sticky !== 0 || popcount(a.group) >= 2),
  );
  if (iCarry >= 0) {
    insights.push({
      score: iCarry - KEY,
      title: 'Nicht nur vorwärts denken',
      text: `Rückfahrten dürfen Passagiere mitnehmen. Manchmal muss jemand wieder ${model.def.sides[window[iCarry]!.to].to}, damit auf der anderen Seite niemand in Gefahr gerät.`,
    });
  }

  // The rule that currently blocks most crossings.
  const tension = ruleTension(model, ctx.state);
  if (tension.size) {
    const [ruleId] = [...tension.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const rule = model.def.rules.find((r) => r.id === ruleId)!;
    insights.push({
      score: 1,
      title: rule.title,
      text: `Gerade scheitern die meisten denkbaren Fahrten an dieser Regel: ${rule.summary} Prüfe vor jeder Abfahrt beide Ufer – auch das, das du verlässt.`,
    });
  }

  insights.sort((a, b) => a.score - b.score);
  const first = insights[0] ?? {
    title: 'Vom Ziel her denken',
    text: `Überlege, wer als Letztes übersetzen muss – und wer ${model.def.vehicleNames.acc} davor zurückbringt.`,
  };

  const legal = model.legalActions(ctx.state);
  const good = optimalFirstMoves(model, ctx.state, best);
  const progress =
    legal.length === 1
      ? `Von hier aus ist nur eine einzige Überfahrt erlaubt.`
      : `Von hier aus sind ${legal.length} Überfahrten erlaubt – ${good.length === 1 ? 'eine davon führt' : `${good.length} davon führen`} auf kürzestem Weg weiter.`;
  return {
    title: first.title,
    text: `${first.text} ${progress} Bestmöglich ${best.cost === 1 ? 'fehlt' : 'fehlen'} noch ${metricUnit(model, best.cost)}.`,
  };
}

export function generateHint(model: PuzzleModel, ctx: HintContext, level: HintLevel): Hint {
  const base: Hint = {
    level,
    title: '',
    text: '',
    focus: [],
    action: null,
    remainingCost: null,
    doomed: false,
    undoSuggested: 0,
  };
  if (model.isGoal(ctx.state)) {
    return { ...base, title: 'Geschafft', text: 'Alle sind sicher angekommen.', remainingCost: 0 };
  }
  const best = solve(model, ctx.state);
  if (!best) {
    return {
      ...base,
      title: 'Sackgasse',
      text: 'Von diesem Zustand aus gibt es keinen gültigen Weg zum Ziel. Nimm die letzte Überfahrt zurück.',
      undoSuggested: 1,
    };
  }
  base.remainingCost = best.cost;

  // Time limit already out of reach → tell the player how far to go back (exact, via search).
  const limit = model.def.cost.type === 'slowest' ? model.def.cost.limit : undefined;
  if (limit !== undefined && ctx.elapsed + best.cost > limit) {
    let undo = 0;
    let elapsed = ctx.elapsed;
    for (let j = ctx.history.length - 1; j >= 0; j--) {
      const entry = ctx.history[j]!;
      elapsed -= entry.cost;
      undo++;
      const alt = solve(model, entry.before);
      if (alt && elapsed + alt.cost <= limit) break;
    }
    const unit = model.def.cost.type === 'slowest' ? model.def.cost.unit : '';
    return {
      ...base,
      doomed: true,
      undoSuggested: undo,
      title: 'Energie reicht nicht mehr',
      text: `Verbraucht sind ${ctx.elapsed} von ${limit} ${unit}. Der schnellste verbleibende Weg bräuchte noch ${best.cost} ${unit} – das Limit ist so nicht mehr zu halten. Nimm ${undo === 1 ? 'die letzte Überfahrt' : `die letzten ${undo} Überfahrten`} zurück (↶).`,
    };
  }

  const next = best.actions[0]!;
  switch (level) {
    case 1: {
      const g = generalInsight(model, ctx, best);
      return { ...base, title: g.title, text: g.text };
    }
    case 2: {
      const who = characterizeGroup(model, ctx.state, next.group);
      const loadHint =
        ctx.load & ~next.group & ~stickyMask(model)
          ? ` Schau dir an, wer gerade ${model.def.vehicleNames.at} sitzt – nicht alle gehören zu dieser Fahrt.`
          : '';
      return {
        ...base,
        title: 'Nächster sinnvoller Schritt',
        text: `Die nächste sinnvolle Überfahrt geht ${directionPhrase(model, next)}. An Bord: ${who}.${loadHint}`,
      };
    }
    case 3: {
      const sticky = stickyMask(model);
      const toRemove = ctx.load & ~next.group & ~sticky;
      const toAdd = next.group & ~ctx.load & ~sticky;
      const parts: string[] = [];
      if (toRemove) parts.push(`Hol ${model.namesOf(toRemove, 'acc')} ${model.def.vehicleNames.from}`);
      if (toAdd) parts.push(`setze ${model.namesOf(toAdd, 'acc')} ${model.def.vehicleNames.into}`);
      let text: string;
      if (!parts.length) {
        text =
          (next.group & ~sticky) === 0 && sticky
            ? `${capitalize(model.namesOf(next.group))} fährt allein ${directionPhrase(model, next)}. Starte die Überfahrt.`
            : `Alles bereit: Starte die Überfahrt ${directionPhrase(model, next)}.`;
      } else {
        text = `${capitalize(parts.join(', '))} und starte die Überfahrt ${directionPhrase(model, next)}.`;
      }
      if (next.cost > 1 || model.def.cost.type === 'slowest') text += ` Dauer: ${metricUnit(model, next.cost)}.`;
      return {
        ...base,
        title: 'Konkreter nächster Zug',
        text,
        focus: model.idsOf(next.group),
        action: next,
      };
    }
  }
}
