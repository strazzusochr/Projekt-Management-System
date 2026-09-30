import type { PuzzleDefinition } from '../puzzle/types';
import type { WorldFactory } from '../world/types';
import { forestPuzzle } from './puzzles/forest';
import { harborPuzzle } from './puzzles/harbor';
import { icePuzzle } from './puzzles/ice';
import { neonPuzzle } from './puzzles/neon';
import { templePuzzle } from './puzzles/temple';

/** Presentation + loading metadata of a level. Worlds are code-split and loaded lazily. */
export interface LevelMeta {
  id: 'forest' | 'temple' | 'neon' | 'harbor' | 'ice';
  index: number;
  name: string;
  subtitle: string;
  description: string;
  /** One-line description of the rule mechanic (shown on the map card). */
  mechanic: string;
  goal: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  puzzle: PuzzleDefinition;
  load: () => Promise<{ default: WorldFactory }>;
}

export const LEVELS: readonly LevelMeta[] = [
  {
    id: 'forest',
    index: 1,
    name: 'Der Flüsterwald',
    subtitle: 'The Whispering Forest',
    description:
      'Im Morgenlicht des uralten Waldes will Hüterin Mira den Wolf, die Ziege und einen prächtigen Kohlkopf über den Fluss zum Herbstfest bringen.',
    mechanic: 'Gefährliche Paare – nur Mira hält Frieden',
    goal: 'Bringe Mira, den Wolf, die Ziege und den Kohlkopf zum Lichtungsufer.',
    difficulty: 1,
    puzzle: forestPuzzle,
    load: () => import('../worlds/forest/index'),
  },
  {
    id: 'temple',
    index: 2,
    name: 'Der versunkene Tempel',
    subtitle: 'The Sunken Temple',
    description:
      'In der Dämmerung einer grünen Schlucht müssen drei Wächter und drei verspielte Chaoswesen mit der Lotosbarke ins Heiligtum übersetzen.',
    mechanic: 'Gleichgewicht – Wächter dürfen nie in Unterzahl sein',
    goal: 'Bringe alle drei Wächter und alle drei Chaoswesen ins Heiligtum.',
    difficulty: 2,
    puzzle: templePuzzle,
    load: () => import('../worlds/temple/index'),
  },
  {
    id: 'neon',
    index: 3,
    name: 'Neonfluss',
    subtitle: 'Midnight Circuit',
    description:
      'Mitternacht in der Megacity: Vier Kuriere müssen mit einer Schwebeplattform über den Kanal – doch die Energiezelle reicht nur 15 Minuten.',
    mechanic: 'Zeit & Energie – die Langsamsten bestimmen das Tempo',
    goal: 'Bringe alle vier Kuriere in höchstens 15 Minuten zum Arkologie-Dock.',
    difficulty: 3,
    puzzle: neonPuzzle,
    load: () => import('../worlds/neon/index'),
  },
  {
    id: 'harbor',
    index: 4,
    name: 'Der Himmelshafen',
    subtitle: 'The Celestial Harbor',
    description:
      'Über einem Meer aus Wolken wollen drei Kapitäne und ihre Gefährten zum Sternenkai – gebunden an den uralten Himmelseid.',
    mechanic: 'Der Himmelseid – Paare und fremde Kapitäne',
    goal: 'Bringe alle drei Kapitäne und ihre Gefährten zum Sternenkai.',
    difficulty: 4,
    puzzle: harborPuzzle,
    load: () => import('../worlds/harbor/index'),
  },
  {
    id: 'ice',
    index: 5,
    name: 'Polarlicht im Eis',
    subtitle: 'Aurora Icebound',
    description:
      'Unter tanzendem Polarlicht bricht das Eis auf: Zwei Forschende, zwei Kinder und Polarhund Nanuk müssen mit der beheizten Fähre zur Station.',
    mechanic: 'Gewicht – die Fähre trägt höchstens 100 kg',
    goal: 'Bringe alle zu Station Polaris – die Plattform trägt maximal 100 kg.',
    difficulty: 5,
    puzzle: icePuzzle,
    load: () => import('../worlds/ice/index'),
  },
];

export const LEVEL_ORDER = LEVELS.map((l) => l.id);

export function levelById(id: string): LevelMeta | undefined {
  return LEVELS.find((l) => l.id === id);
}
