import { PuzzleModel, type PuzzleState } from './engine';
import type { CrossingAction } from './types';

export interface Solution {
  /** Total cost in the level metric (crossings or minutes). */
  cost: number;
  crossings: number;
  actions: CrossingAction[];
  /** States visited along the path, starting with the start state. */
  states: PuzzleState[];
}

/** Minimal binary heap keyed by (cost, crossings, sequence) for deterministic Dijkstra. */
class MinHeap<T extends { k1: number; k2: number; seq: number }> {
  private data: T[] = [];
  get size(): number {
    return this.data.length;
  }
  private less(a: T, b: T): boolean {
    return a.k1 !== b.k1 ? a.k1 < b.k1 : a.k2 !== b.k2 ? a.k2 < b.k2 : a.seq < b.seq;
  }
  push(item: T): void {
    const d = this.data;
    d.push(item);
    let i = d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(d[i]!, d[p]!)) break;
      [d[i], d[p]] = [d[p]!, d[i]!];
      i = p;
    }
  }
  pop(): T | undefined {
    const d = this.data;
    if (!d.length) return undefined;
    const top = d[0]!;
    const last = d.pop()!;
    if (d.length) {
      d[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < d.length && this.less(d[l]!, d[m]!)) m = l;
        if (r < d.length && this.less(d[r]!, d[m]!)) m = r;
        if (m === i) break;
        [d[i], d[m]] = [d[m]!, d[i]!];
        i = m;
      }
    }
    return top;
  }
}

interface Node {
  state: PuzzleState;
  k1: number;
  k2: number;
  seq: number;
}

/**
 * Exact shortest path search (Dijkstra; with unit costs it degenerates to BFS order).
 * Primary key: level metric. Secondary key: number of crossings. Ties are broken by the
 * deterministic action enumeration order, so hints are stable between calls.
 */
export function solve(model: PuzzleModel, from: PuzzleState = model.startState): Solution | null {
  if (!model.isValidState(from)) return null;
  const dist = new Map<PuzzleState, { k1: number; k2: number }>();
  const prev = new Map<PuzzleState, { state: PuzzleState; action: CrossingAction }>();
  const heap = new MinHeap<Node>();
  let seq = 0;
  dist.set(from, { k1: 0, k2: 0 });
  heap.push({ state: from, k1: 0, k2: 0, seq: seq++ });
  const done = new Set<PuzzleState>();
  while (heap.size) {
    const cur = heap.pop()!;
    if (done.has(cur.state)) continue;
    done.add(cur.state);
    if (model.isGoal(cur.state)) {
      // reconstruct
      const actions: CrossingAction[] = [];
      const states: PuzzleState[] = [cur.state];
      let s = cur.state;
      while (s !== from) {
        const p = prev.get(s)!;
        actions.push(p.action);
        s = p.state;
        states.push(s);
      }
      actions.reverse();
      states.reverse();
      return { cost: cur.k1, crossings: cur.k2, actions, states };
    }
    for (const a of model.legalActions(cur.state)) {
      const next = model.applyCrossing(cur.state, a.group);
      if (done.has(next)) continue;
      const k1 = cur.k1 + a.cost;
      const k2 = cur.k2 + 1;
      const known = dist.get(next);
      if (!known || k1 < known.k1 || (k1 === known.k1 && k2 < known.k2)) {
        dist.set(next, { k1, k2 });
        prev.set(next, { state: cur.state, action: a });
        heap.push({ state: next, k1, k2, seq: seq++ });
      }
    }
  }
  return null;
}

/**
 * Minimal remaining cost to the goal for every state reachable from `from`
 * (multi-source reverse Dijkstra is not needed: the spaces are tiny, so we run
 * one exact search from each reachable state lazily and memoise).
 */
export class DistanceOracle {
  private cache = new Map<PuzzleState, Solution | null>();
  constructor(private readonly model: PuzzleModel) {}
  get(state: PuzzleState): Solution | null {
    if (!this.cache.has(state)) this.cache.set(state, solve(this.model, state));
    return this.cache.get(state)!;
  }
}

export interface StateSpaceStats {
  totalStates: number;
  validStates: number;
  forbiddenStates: number;
  reachableStates: number;
  reachableEdges: number;
  goalReachable: boolean;
  /** Number of distinct optimal solutions (by metric, then crossings). */
  optimalSolutionCount: number;
}

/** Exhaustive analysis of the full state space. */
export function analyzeStateSpace(model: PuzzleModel, from: PuzzleState = model.startState): StateSpaceStats {
  let valid = 0;
  for (let s = 0; s < model.totalStates; s++) if (model.isValidState(s)) valid++;

  // reachable set (BFS over legal actions)
  const seen = new Set<PuzzleState>([from]);
  const queue: PuzzleState[] = [from];
  let edges = 0;
  let goalReachable = false;
  while (queue.length) {
    const s = queue.shift()!;
    if (model.isGoal(s)) goalReachable = true;
    for (const a of model.legalActions(s)) {
      edges++;
      const n = model.applyCrossing(s, a.group);
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }

  return {
    totalStates: model.totalStates,
    validStates: valid,
    forbiddenStates: model.totalStates - valid,
    reachableStates: seen.size,
    reachableEdges: edges,
    goalReachable,
    optimalSolutionCount: countOptimalSolutions(model, from),
  };
}

/** Counts optimal paths (primary metric, secondary crossings) via Dijkstra + path counting. */
export function countOptimalSolutions(model: PuzzleModel, from: PuzzleState = model.startState): number {
  if (!model.isValidState(from)) return 0;
  const key = (k1: number, k2: number) => k1 * 1024 + k2;
  const dist = new Map<PuzzleState, number>();
  const ways = new Map<PuzzleState, number>();
  const heap = new MinHeap<Node>();
  let seq = 0;
  dist.set(from, 0);
  ways.set(from, 1);
  heap.push({ state: from, k1: 0, k2: 0, seq: seq++ });
  const done = new Set<PuzzleState>();
  let best = Infinity;
  let count = 0;
  while (heap.size) {
    const cur = heap.pop()!;
    if (done.has(cur.state)) continue;
    const ck = key(cur.k1, cur.k2);
    if (ck > best) break;
    done.add(cur.state);
    if (model.isGoal(cur.state)) {
      best = ck;
      count += ways.get(cur.state)!;
      continue;
    }
    for (const a of model.legalActions(cur.state)) {
      const next = model.applyCrossing(cur.state, a.group);
      if (done.has(next)) continue;
      const nk = key(cur.k1 + a.cost, cur.k2 + 1);
      const known = dist.get(next);
      if (known === undefined || nk < known) {
        dist.set(next, nk);
        ways.set(next, ways.get(cur.state)!);
        heap.push({ state: next, k1: cur.k1 + a.cost, k2: cur.k2 + 1, seq: seq++ });
      } else if (nk === known) {
        ways.set(next, ways.get(next)! + ways.get(cur.state)!);
      }
    }
  }
  return count;
}
