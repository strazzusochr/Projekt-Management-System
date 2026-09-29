import { describe, expect, it } from 'vitest';
import { PuzzleModel, popcount } from '../../src/puzzle/engine';
import { solve } from '../../src/puzzle/solver';
import { PuzzleSession } from '../../src/puzzle/session';
import { validateLevel } from '../../src/puzzle/validation';
import { PUZZLES, puzzleById } from '../../src/levels/puzzles';
import { icePeople, icePuzzle } from '../../src/levels/puzzles/ice';
import type { PuzzleDefinition } from '../../src/puzzle/types';

const model = (id: string) => new PuzzleModel(puzzleById(id)!);

/** Plays a list of groups (entity ids) through a session, asserting each crossing is accepted. */
function play(session: PuzzleSession, groups: string[][]) {
  for (const g of groups) {
    for (const id of session.loadIds()) if (!g.includes(id)) session.unboard(id);
    for (const id of g) expect(session.board(id).ok, `board ${id}`).toBe(true);
    const r = session.sail();
    expect(r.ok, `sail ${g.join('+')}: ${r.violations.map((v) => v.message).join(' | ')}`).toBe(true);
  }
}

describe('level validation (7 mandatory checks)', () => {
  const expected: Record<string, { cost: number; crossings: number; valid: number; total: number }> = {
    forest: { cost: 7, crossings: 7, valid: 20, total: 32 },
    temple: { cost: 11, crossings: 11, valid: 68, total: 128 },
    neon: { cost: 15, crossings: 5, valid: 32, total: 32 },
    harbor: { cost: 11, crossings: 11, valid: 44, total: 128 },
    ice: { cost: 11, crossings: 11, valid: 64, total: 64 },
  };
  for (const def of PUZZLES) {
    it(`${def.id}: valid, solvable, optimal = ${expected[def.id]!.cost}`, () => {
      const r = validateLevel(def);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.startValid).toBe(true);
      expect(r.goalDefined).toBe(true);
      expect(r.solvable).toBe(true);
      expect(r.optimal!.cost).toBe(expected[def.id]!.cost);
      expect(r.optimal!.crossings).toBe(expected[def.id]!.crossings);
      expect(r.stats!.totalStates).toBe(expected[def.id]!.total);
      expect(r.stats!.validStates).toBe(expected[def.id]!.valid);
      expect(r.stats!.forbiddenStates).toBe(expected[def.id]!.total - expected[def.id]!.valid);
      expect(r.legalStartActions.length).toBeGreaterThan(0);
    });
  }

  it('historic weight variant without the dog needs 9 crossings', () => {
    const r = validateLevel({ ...icePuzzle, id: 'ice-pure', entities: icePeople });
    expect(r.optimal!.cost).toBe(9);
  });

  it('marks an unsolvable level as error', () => {
    const broken: PuzzleDefinition = {
      ...puzzleById('forest')!,
      id: 'broken',
      vehicle: { capacity: 1, requirePilot: true, stickyPilots: ['keeper'] },
    };
    const r = validateLevel(broken);
    expect(r.ok).toBe(false);
    expect(r.solvable).toBe(false);
    expect(r.errors.join(' ')).toMatch(/nicht lösbar|keine einzige/);
  });

  it('marks an invalid start state as error', () => {
    const def = puzzleById('forest')!;
    const r = validateLevel({ ...def, id: 'bad-start', start: { vehicleSide: 1, entitySides: { keeper: 1 } } });
    expect(r.startValid).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('rejects a time limit that is below the optimum', () => {
    const def = puzzleById('neon')!;
    const r = validateLevel({ ...def, id: 'neon-14', cost: { ...def.cost, limit: 14 } as PuzzleDefinition['cost'] });
    expect(r.ok).toBe(false);
  });
});

describe('rules and explanations', () => {
  it('forest: wolf and goat left alone → explained violation', () => {
    const s = new PuzzleSession(model('forest'));
    s.board('cabbage');
    const r = s.checkDeparture();
    expect(r.ok).toBe(false);
    expect(r.violations[0]!.message).toContain('Der Wolf würde die Ziege fressen');
    expect(r.violations[0]!.entities).toEqual(['wolf', 'goat']);
    expect(r.violations[0]!.location).toBe(0);
  });

  it('forest: keeper is a sticky pilot and cannot leave the boat', () => {
    const s = new PuzzleSession(model('forest'));
    expect(s.isAboard('keeper')).toBe(true);
    expect(s.unboard('keeper').ok).toBe(false);
    expect(s.board('wolf').ok).toBe(true);
    expect(s.board('goat').ok).toBe(false); // capacity 2
  });

  it('temple: outnumbered guardians are rejected on the departure bank', () => {
    const s = new PuzzleSession(model('temple'));
    s.board('guardian1');
    s.board('guardian2');
    const r = s.checkDeparture();
    expect(r.ok).toBe(false);
    expect(r.violations[0]!.ruleId).toBe('outnumber');
    expect(r.violations[0]!.message).toContain('3 Chaoswesen nur 1 Wächter');
    expect(r.violations[0]!.message).not.toMatch(/fress|essen/i);
  });

  it('temple: both banks are checked simultaneously', () => {
    const m = model('temple');
    // guardian1+chaos1 cross, guardian1 returns → right bank: chaos1 alone (fine). Now send chaos2 alone:
    const s = new PuzzleSession(m);
    play(s, [['guardian1', 'chaos1'], ['guardian1']]);
    s.board('guardian2');
    // left would be: g1,g3,c2,c3 (2 vs 2 ok); right: g2,c1 (1 vs 1 ok) → allowed
    expect(s.checkDeparture().ok).toBe(true);
    s.unboard('guardian2');
    s.board('chaos2');
    s.board('guardian1');
    // left: g2,g3,c3 ok; right: g1,c1,c2 → 2 chaos vs 1 guardian → invalid on the ARRIVAL bank
    const r = s.checkDeparture();
    expect(r.ok).toBe(false);
    expect(r.violations[0]!.location).toBe(1);
  });

  it('temple: vehicle never moves empty', () => {
    const s = new PuzzleSession(model('temple'));
    const r = s.checkDeparture();
    expect(r.ok).toBe(false);
    expect(r.violations[0]!.kind).toBe('empty');
  });

  it('neon: crossing time = slower courier, limit enforced with explanation', () => {
    const s = new PuzzleSession(model('neon'));
    play(s, [['nova', 'oskar'], ['nova'], ['nova', 'mara'], ['nova']]);
    expect(s.elapsed).toBe(8 + 1 + 5 + 1);
    s.board('nova');
    s.board('kai');
    const r = s.checkDeparture();
    expect(r.ok).toBe(false);
    expect(r.violations[0]!.kind).toBe('timeLimit');
    expect(s.failed).toBe(true);
    const h = s.hint(1);
    expect(h.doomed).toBe(true);
    expect(h.undoSuggested).toBeGreaterThan(0);
  });

  it('neon: optimal plan finishes in exactly 15 minutes', () => {
    const s = new PuzzleSession(model('neon'));
    play(s, [['nova', 'kai'], ['nova'], ['mara', 'oskar'], ['kai'], ['nova', 'kai']]);
    expect(s.won).toBe(true);
    expect(s.elapsed).toBe(15);
    expect(s.rating()).toBe(3);
  });

  it('harbor: the oath applies inside the skiff as well', () => {
    const s = new PuzzleSession(model('harbor'));
    s.board('lyra');
    s.board('brann');
    const r = s.checkDeparture();
    expect(r.ok).toBe(false);
    const v = r.violations.find((x) => x.location === 'vehicle');
    expect(v).toBeDefined();
    expect(v!.message).toContain('Lyra');
    expect(v!.message).toContain('Kapitän Brann');
    expect(v!.message).toContain('Kapitän Aurel');
  });

  it('harbor: companions left with a foreign captain on a pier are rejected', () => {
    const s = new PuzzleSession(model('harbor'));
    s.board('aurel');
    const r = s.checkDeparture();
    expect(r.ok).toBe(false);
    expect(r.violations[0]!.entities[0]).toBe('lyra');
  });

  it('ice: weight limit is enforced when boarding, with numbers', () => {
    const s = new PuzzleSession(model('ice'));
    expect(s.board('henrik').ok).toBe(true);
    const r = s.board('lumi');
    expect(r.ok).toBe(false);
    expect(r.violation!.kind).toBe('weight');
    expect(r.violation!.message).toContain('150 kg');
  });

  it('ice: the dog cannot steer alone', () => {
    const s = new PuzzleSession(model('ice'));
    s.board('nanuk');
    const r = s.checkDeparture();
    expect(r.ok).toBe(false);
    expect(r.violations[0]!.kind).toBe('noPilot');
  });
});

describe('session: undo / reset / win', () => {
  it('undo restores the previous bank and puts the group back aboard', () => {
    const s = new PuzzleSession(model('forest'));
    const start = s.state;
    play(s, [['keeper', 'goat']]);
    expect(s.location('goat')).toBe('right');
    const e = s.undo();
    expect(e).not.toBeNull();
    expect(s.state).toBe(start);
    expect(s.moves).toBe(0);
    expect(s.isAboard('goat')).toBe(true);
    expect(s.location('goat')).toBe('boat');
  });

  it('reset returns to the start state', () => {
    const s = new PuzzleSession(model('temple'));
    play(s, [['guardian1', 'chaos1'], ['guardian1']]);
    s.reset();
    expect(s.state).toBe(s.model.startState);
    expect(s.moves).toBe(0);
    expect(s.history).toHaveLength(0);
    expect(s.load).toBe(0);
  });

  for (const def of PUZZLES) {
    it(`${def.id}: solver solution replayed through the session wins with 3 stars`, () => {
      const m = new PuzzleModel(def);
      const sol = solve(m)!;
      const s = new PuzzleSession(m);
      play(
        s,
        sol.actions.map((a) => m.idsOf(a.group)),
      );
      expect(s.won).toBe(true);
      expect(s.rating()).toBe(3);
    });
  }
});

describe('hints are derived from the solver', () => {
  for (const def of PUZZLES) {
    it(`${def.id}: from every reachable state, hint 3 names an optimal legal move`, () => {
      const m = new PuzzleModel(def);
      const seen = new Set<number>([m.startState]);
      const queue = [m.startState];
      let checked = 0;
      while (queue.length) {
        const st = queue.shift()!;
        for (const a of m.legalActions(st)) {
          const n = m.applyCrossing(st, a.group);
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
        if (m.isGoal(st)) continue;
        const s = new PuzzleSession(m);
        s.state = st;
        s.load = 0;
        const best = solve(m, st)!;
        const h1 = s.hint(1);
        const h2 = s.hint(2);
        const h3 = s.hint(3);
        for (const h of [h1, h2, h3]) {
          expect(h.text.length).toBeGreaterThan(20);
          expect(h.text).not.toMatch(/\{|undefined|NaN/);
        }
        if (h3.doomed) continue;
        expect(h3.action).not.toBeNull();
        const r = m.tryCrossing(st, h3.action!.group);
        expect(r.ok).toBe(true);
        const rest = solve(m, r.next)!;
        expect(h3.action!.cost + rest.cost).toBe(best.cost);
        expect(h3.focus.length).toBe(popcount(h3.action!.group));
        // level 2 must not reveal individual names of interchangeable pieces
        if (def.id === 'temple') expect(h2.text).not.toMatch(/Arun|Sela|Kiran|Zikk|Mok|Pell/);
        checked++;
      }
      expect(checked).toBeGreaterThan(3);
    });
  }

  it('forest: hint 3 at the start tells to take the goat', () => {
    const s = new PuzzleSession(model('forest'));
    const h = s.hint(3);
    expect(h.text).toContain('die Ziege');
    expect(h.text).toContain('Lichtungsufer');
    expect(h.focus).toEqual(['keeper', 'goat']);
  });

  it('hint stages advance 1 → 2 → 3 and reset after a crossing', () => {
    const s = new PuzzleSession(model('forest'));
    expect(s.nextHint().level).toBe(1);
    expect(s.nextHint().level).toBe(2);
    expect(s.nextHint().level).toBe(3);
    expect(s.nextHint().level).toBe(3);
    play(s, [['keeper', 'goat']]);
    expect(s.nextHint().level).toBe(1);
  });
});
