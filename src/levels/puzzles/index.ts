import type { PuzzleDefinition } from '../../puzzle/types';
import { forestPuzzle } from './forest';
import { harborPuzzle } from './harbor';
import { icePuzzle } from './ice';
import { neonPuzzle } from './neon';
import { templePuzzle } from './temple';

/** All puzzle definitions in campaign order (pure data – safe to import in tests). */
export const PUZZLES: readonly PuzzleDefinition[] = [forestPuzzle, templePuzzle, neonPuzzle, harborPuzzle, icePuzzle];

export function puzzleById(id: string): PuzzleDefinition | undefined {
  return PUZZLES.find((p) => p.id === id);
}
