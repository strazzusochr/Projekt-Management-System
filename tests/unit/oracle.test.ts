/**
 * Riverbound QA – Unit-Tests für das unabhängige Rätsel-Orakel (tests/oracle/).
 * Schreibt die gegengeprüften Werte fest und legt einen lesbaren Bericht unter qa-output/oracle/ ab.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeLevel,
  checkSequence,
  L1_FOREST,
  L2_TEMPLE,
  L3_NEON,
  L4_HARBOR,
  L4_HARBOR_BANKS_ONLY,
  L5_ICE_DOG,
  L5_ICE_PURE,
  ORACLE_EXPECTED,
  ORACLE_LEVELS,
  solveFrom,
  stateFrom,
  type OracleReport,
} from '../oracle';

const reports = new Map<string, OracleReport>(ORACLE_LEVELS.map((l) => [l.id, analyzeLevel(l)]));

describe('Orakel – festgeschriebene Werte', () => {
  for (const level of ORACLE_LEVELS) {
    it(`${level.id}: ${level.title}`, () => {
      const r = reports.get(level.id)!;
      const exp = ORACLE_EXPECTED[level.id];
      expect(exp, `kein Erwartungswert für ${level.id}`).toBeDefined();
      expect({
        metric: r.metric,
        figures: r.figures,
        optimalCost: r.optimalCost,
        optimalCrossings: r.optimalCrossings,
        optimalSolutionCount: r.optimalSolutionCount,
        totalStates: r.totalStates,
        validStates: r.validStates,
        forbiddenStates: r.forbiddenStates,
        reachableStates: r.reachableStates,
        reachableTransitions: r.reachableTransitions,
        forbiddenSuccessorStates: r.forbiddenSuccessorStates,
        ...(r.reachableWithinLimit !== undefined ? { reachableWithinLimit: r.reachableWithinLimit } : {}),
      }).toEqual(exp);
    });
  }

  it('Kernzahlen laut Auftrag: L1 7, L2 11, L3 15 Min/5 Fahrten, L4 11, L5 mit Hund 11, ohne Hund 9', () => {
    const cost = (id: string) => reports.get(id)!.optimalCost;
    expect(cost('forest')).toBe(7);
    expect(cost('temple')).toBe(11);
    expect(cost('neon')).toBe(15);
    expect(reports.get('neon')!.optimalCrossings).toBe(5);
    expect(cost('harbor')).toBe(11);
    expect(cost('ice')).toBe(11);
    expect(cost('ice-pure')).toBe(9);
  });
});

describe('Orakel – Konsistenz der optimalen Sequenzen', () => {
  for (const level of ORACLE_LEVELS) {
    it(`${level.id}: Sequenz ist regelkonform, erreicht das Ziel und kostet genau das Optimum`, () => {
      const r = reports.get(level.id)!;
      const check = checkSequence(level, r.sequence.map((s) => s.group));
      expect(check.error).toBeUndefined();
      expect(check.ok).toBe(true);
      expect(check.reachedGoal).toBe(true);
      expect(check.cost).toBe(r.optimalCost);
      expect(check.crossings).toBe(r.optimalCrossings);
      // Richtungen wechseln sich ab, Start nach rechts
      r.sequence.forEach((s, i) => expect(s.to).toBe(i % 2 === 0 ? 'right' : 'left'));
      // Bellman-Konsistenz: Restkosten ab jedem Zwischenzustand = Optimum − bisherige Kosten
      const rightIds = new Set<string>();
      for (const step of r.sequence) {
        step.group.forEach((id) => (step.to === 'right' ? rightIds.add(id) : rightIds.delete(id)));
        const rest = solveFrom(level, stateFrom(level, [...rightIds], step.to));
        expect(rest?.cost).toBe((r.optimalCost ?? 0) - step.total);
      }
    });
  }

  it('Analyse ist deterministisch (zweiter Lauf identisch)', () => {
    for (const level of ORACLE_LEVELS) expect(analyzeLevel(level)).toEqual(reports.get(level.id));
  });
});

describe('Orakel – verbotene Züge werden mit Begründung abgelehnt', () => {
  it('L1: Hüterin fährt allein los → Wolf frisst Ziege', () => {
    const c = checkSequence(L1_FOREST, [['hueterin']]);
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/Wolf würde die Ziege fressen/);
  });
  it('L1: Wolf zuerst → Ziege frisst Kohl', () => {
    expect(checkSequence(L1_FOREST, [['hueterin', 'wolf']]).error).toMatch(/Ziege würde den Kohl fressen/);
  });
  it('L1: nur die Hüterin steuert, max. ein Passagier', () => {
    expect(checkSequence(L1_FOREST, [['ziege']]).error).toMatch(/steuern/);
    expect(checkSequence(L1_FOREST, [['hueterin', 'ziege', 'kohl']]).error).toMatch(/Zu viele/);
  });
  it('L1/L2: leeres Boot fährt nicht', () => {
    expect(checkSequence(L1_FOREST, [[]]).error).toMatch(/leer/);
    expect(checkSequence(L2_TEMPLE, [[]]).error).toMatch(/leer/);
  });
  it('L2: zwei Wächter zuerst → Startufer 1 Wächter gegen 3 Chaoswesen', () => {
    expect(checkSequence(L2_TEMPLE, [['waechter1', 'waechter2']]).error).toMatch(/Startufer: 3 Chaoswesen gegen 1 Wächter/);
  });
  it('L2: Ufer ohne Wächter darf beliebig viele Chaoswesen haben', () => {
    const c = checkSequence(L2_TEMPLE, [['chaos1', 'chaos2'], ['chaos1'], ['chaos1', 'chaos3']]);
    expect(c.ok).toBe(true);
  });
  it('L3: gierige Eskorte durch A überschreitet das Zeitlimit (17 > 15)', () => {
    const c = checkSequence(L3_NEON, [['A', 'D'], ['A'], ['A', 'C'], ['A'], ['A', 'B']]);
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/Zeitlimit überschritten \(17 > 15\)/);
    expect(c.failedAt).toBe(4);
  });
  it('L3: Dauer = langsamere Person, Licht wandert mit (Rückfahrt nur von der Plattformseite)', () => {
    const c = checkSequence(L3_NEON, [['C', 'D']]);
    expect(c.ok).toBe(true);
    expect(c.cost).toBe(8);
    expect(checkSequence(L3_NEON, [['C', 'D'], ['A']]).error).toMatch(/Bootseite/);
    expect(checkSequence(L3_NEON, [['A', 'B', 'C']]).error).toMatch(/Zu viele/);
  });
  it('L4: Companion mit fremdem Captain im Boot → verboten (Ufer+Boot) bzw. am Ankunftsufer (nur Ufer)', () => {
    expect(checkSequence(L4_HARBOR, [['companion1', 'captain2']]).error).toMatch(/^Im Boot: companion1 bei captain2 ohne captain1/);
    expect(checkSequence(L4_HARBOR_BANKS_ONLY, [['companion1', 'captain2']]).error).toMatch(/ufer: companion/);
  });
  it('L4: Boot-Regel ist bei Kapazität 2 redundant – beide Varianten haben identischen Zustandsraum', () => {
    const a = reports.get('harbor')!;
    const b = reports.get('harbor-banks-only')!;
    expect({ ...a, id: '', title: '' }).toEqual({ ...b, id: '', title: '' });
  });
  it('L5: Gewicht, Kapazität und Steuerfähigkeit', () => {
    expect(checkSequence(L5_ICE_PURE, [['erwachsener1', 'kind1']]).error).toMatch(/Zu schwer \(150 kg > 100 kg\)/);
    expect(checkSequence(L5_ICE_PURE, [['erwachsener1', 'erwachsener2']]).error).toMatch(/Zu schwer/);
    expect(checkSequence(L5_ICE_DOG, [['hund']]).error).toMatch(/steuern/);
    expect(checkSequence(L5_ICE_DOG, [['kind1', 'kind2', 'hund']]).error).toMatch(/Zu schwer \(125 kg > 100 kg\)/);
    expect(checkSequence(L5_ICE_DOG, [['kind1', 'hund']]).ok).toBe(true);
  });
});

describe('Orakel – Bericht', () => {
  it('schreibt qa-output/oracle/report.json und eine Übersicht', () => {
    const out = fileURLToPath(new URL('../../qa-output/oracle/', import.meta.url));
    mkdirSync(out, { recursive: true });
    const all = [...reports.values()];
    writeFileSync(resolve(out, 'report.json'), JSON.stringify(all, null, 1));
    const lines = all.map(
      (r) =>
        `${r.id.padEnd(18)} opt=${String(r.optimalCost).padStart(2)}${r.metric === 'time' ? ' Min' : ' Ü. '} Fahrten=${String(r.optimalCrossings).padStart(2)} ` +
        `Lösungen=${String(r.optimalSolutionCount).padStart(4)} Zustände=${r.totalStates} gültig=${r.validStates} verboten=${r.forbiddenStates} ` +
        `erreichbar=${r.reachableStates} | ${r.sequence.map((s) => `[${s.group.join('+')}]${s.to === 'right' ? '→' : '←'}`).join(' ')}`,
    );
    writeFileSync(resolve(out, 'summary.txt'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
    expect(all).toHaveLength(ORACLE_LEVELS.length);
  });
});
