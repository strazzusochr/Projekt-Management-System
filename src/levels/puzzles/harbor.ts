import type { PuzzleDefinition } from '../../puzzle/types';

/**
 * LEVEL 4 – The Celestial Harbor: three captain/companion pairs bound by the "Sky Oath"
 * (jealous-husbands family). A companion must never share a pier – or the skiff – with a foreign
 * captain unless their own captain is there as well.
 */
export const harborPuzzle: PuzzleDefinition = {
  id: 'harbor',
  entities: [
    {
      id: 'aurel',
      name: 'Kapitän Aurel',
      kind: 'captain',
      role: 'captain',
      pairId: 'sun',
      canPilot: true,
      trait: 'Kapitän der „Sonnenfalke“ · Gefährtin: Lyra',
      flavor: 'Groß, stolz, goldener Mantel.',
    },
    {
      id: 'lyra',
      name: 'Lyra',
      kind: 'companion',
      role: 'companion',
      pairId: 'sun',
      canPilot: true,
      trait: 'Navigatorin der „Sonnenfalke“ · gehört zu Kapitän Aurel',
      flavor: 'Liest den Wind wie andere Bücher.',
    },
    {
      id: 'brann',
      name: 'Kapitän Brann',
      kind: 'captain',
      role: 'captain',
      pairId: 'storm',
      canPilot: true,
      trait: 'Kapitän der „Sturmwal“ · Gefährte: Tamsin',
      flavor: 'Breit wie ein Fass, laut wie ein Donner.',
    },
    {
      id: 'tamsin',
      name: 'Tamsin',
      kind: 'companion',
      role: 'companion',
      pairId: 'storm',
      canPilot: true,
      trait: 'Takelmeister der „Sturmwal“ · gehört zu Kapitän Brann',
      flavor: 'Klettert schneller als jede Möwe.',
    },
    {
      id: 'ysolde',
      name: 'Kapitänin Ysolde',
      kind: 'captain',
      role: 'captain',
      pairId: 'star',
      canPilot: true,
      trait: 'Kapitänin der „Sternenharfe“ · Gefährte: Pim',
      flavor: 'Elegant, streng, ein Monokel aus Mondglas.',
    },
    {
      id: 'pim',
      name: 'Pim',
      kind: 'companion',
      role: 'companion',
      pairId: 'star',
      canPilot: true,
      trait: 'Schiffsjunge der „Sternenharfe“ · gehört zu Kapitänin Ysolde',
      flavor: 'Klein, flink und immer mit Fernrohr.',
    },
  ],
  rules: [
    {
      id: 'sky-oath',
      type: 'pairGuard',
      wards: { role: 'companion' },
      guards: { role: 'captain' },
      scope: 'banksAndVehicle',
      title: 'Der Himmelseid wäre gebrochen',
      summary: 'Ein Gefährte bleibt nie bei einem fremden Kapitän, wenn der eigene Kapitän fehlt – weder am Pier noch im Skiff.',
      icon: 'oath',
      message:
        'Diese Konstellation ist nicht zulässig: {ward} wäre {loc} bei {foreign}, ohne dass {own} dabei ist – nach dem Himmelseid gälte das als Anheuern durch eine fremde Crew.',
    },
  ],
  vehicle: { capacity: 2, requirePilot: true },
  roleLabels: {
    captain: { one: 'ein Kapitän', many: '{n} Kapitäne' },
    companion: { one: 'ein Gefährte', many: '{n} Gefährten' },
  },
  cost: { type: 'crossings' },
  sides: [
    { name: 'Sonnenpier', at: 'am Sonnenpier', to: 'zum Sonnenpier' },
    { name: 'Sternenkai', at: 'am Sternenkai', to: 'zum Sternenkai' },
  ],
  vehicleNames: { name: 'Himmelsskiff', at: 'im Skiff', into: 'ins Skiff', nom: 'das Skiff', acc: 'das Skiff', from: 'aus dem Skiff' },
};
