/**
 * Riverbound QA – Orakel: öffentliche Schnittstelle für Unit- und E2E-Tests.
 * Keine Imports aus `src/`.
 */
export * from './core';
export * from './levels';
import type { OracleLevel } from './core';
import { L1_FOREST, L2_TEMPLE, L3_NEON, L4_HARBOR, L5_ICE_DOG } from './levels';

/** Level-IDs des Spiels laut QA-Vertrag, in Kampagnenreihenfolge. */
export const GAME_LEVEL_IDS = ['forest', 'temple', 'neon', 'harbor', 'ice'] as const;
export type GameLevelId = (typeof GAME_LEVEL_IDS)[number];

/** Welches Orakel-Level entspricht welchem Spiel-Level (Spiel-L4 prüft Ufer + Boot, Spiel-L5 hat den Hund). */
export const ORACLE_FOR_GAME_LEVEL: Readonly<Record<GameLevelId, OracleLevel>> = {
  forest: L1_FOREST,
  temple: L2_TEMPLE,
  neon: L3_NEON,
  harbor: L4_HARBOR,
  ice: L5_ICE_DOG,
};

export interface ExpectedOracleValues {
  metric: 'crossings' | 'time';
  figures: number;
  optimalCost: number;
  optimalCrossings: number;
  optimalSolutionCount: number;
  totalStates: number;
  validStates: number;
  forbiddenStates: number;
  reachableStates: number;
  reachableTransitions: number;
  forbiddenSuccessorStates: number;
  reachableWithinLimit?: number;
}

/**
 * Festgeschriebene, von Hand gegengeprüfte Orakel-Werte (siehe docs/QA-PLAN.md, Abschnitt Orakel).
 * Schlüssel = Orakel-Level-ID (Spiel-Level-IDs plus Varianten).
 */
export const ORACLE_EXPECTED: Readonly<Record<string, ExpectedOracleValues>> = {
  forest: { metric: 'crossings', figures: 4, optimalCost: 7, optimalCrossings: 7, optimalSolutionCount: 2, totalStates: 32, validStates: 20, forbiddenStates: 12, reachableStates: 10, reachableTransitions: 20, forbiddenSuccessorStates: 6 },
  temple: { metric: 'crossings', figures: 6, optimalCost: 11, optimalCrossings: 11, optimalSolutionCount: 8100, totalStates: 128, validStates: 68, forbiddenStates: 60, reachableStates: 64, reachableTransitions: 252, forbiddenSuccessorStates: 60 },
  neon: { metric: 'time', figures: 4, optimalCost: 15, optimalCrossings: 5, optimalSolutionCount: 2, totalStates: 32, validStates: 32, forbiddenStates: 0, reachableStates: 30, reachableTransitions: 112, forbiddenSuccessorStates: 0, reachableWithinLimit: 26 },
  harbor: { metric: 'crossings', figures: 6, optimalCost: 11, optimalCrossings: 11, optimalSolutionCount: 486, totalStates: 128, validStates: 44, forbiddenStates: 84, reachableStates: 40, reachableTransitions: 120, forbiddenSuccessorStates: 84 },
  'harbor-banks-only': { metric: 'crossings', figures: 6, optimalCost: 11, optimalCrossings: 11, optimalSolutionCount: 486, totalStates: 128, validStates: 44, forbiddenStates: 84, reachableStates: 40, reachableTransitions: 120, forbiddenSuccessorStates: 84 },
  ice: { metric: 'crossings', figures: 5, optimalCost: 11, optimalCrossings: 11, optimalSolutionCount: 96, totalStates: 64, validStates: 64, forbiddenStates: 0, reachableStates: 60, reachableTransitions: 176, forbiddenSuccessorStates: 0 },
  'ice-pure': { metric: 'crossings', figures: 4, optimalCost: 9, optimalCrossings: 9, optimalSolutionCount: 8, totalStates: 32, validStates: 32, forbiddenStates: 0, reachableStates: 30, reachableTransitions: 72, forbiddenSuccessorStates: 0 },
};

/** Erwartete Werte für ein Spiel-Level (für E2E: `levels()[i].optimalCost`, `metric`, Figurenzahl). */
export function expectedForGameLevel(id: GameLevelId): ExpectedOracleValues {
  return ORACLE_EXPECTED[ORACLE_FOR_GAME_LEVEL[id].id];
}
