import type { EntityDef, PuzzleDefinition } from '../../puzzle/types';

/**
 * LEVEL 5 – Aurora Icebound: weight-based crossing inspired by the historical
 * "two adults and two children" puzzle (adult = 100 kg, child = 50 kg, platform ≤ 100 kg).
 * Game adaptation (explicit): all four humans may steer the heated ferry platform.
 * Extension: the polar dog Nanuk (25 kg) must come along too, but cannot steer.
 */
export const icePeople: EntityDef[] = [
  {
    id: 'henrik',
    name: 'Dr. Henrik',
    kind: 'adult',
    role: 'adult',
    canPilot: true,
    weight: 100,
    trait: 'Glaziologe · 100 kg mit Ausrüstung · kann steuern',
    flavor: 'Misst seit 20 Jahren das Atmen des Eises.',
  },
  {
    id: 'sana',
    name: 'Dr. Sana',
    kind: 'adult',
    role: 'adult',
    canPilot: true,
    weight: 100,
    trait: 'Polarphysikerin · 100 kg mit Ausrüstung · kann steuern',
    flavor: 'Hat die Polarlicht-Sonde selbst gebaut.',
  },
  {
    id: 'lumi',
    name: 'Lumi',
    kind: 'child',
    role: 'child',
    canPilot: true,
    weight: 50,
    trait: 'Kind · 50 kg · kann steuern',
    flavor: 'Zählt jede Sternschnuppe laut mit.',
  },
  {
    id: 'aki',
    name: 'Aki',
    kind: 'child',
    role: 'child',
    canPilot: true,
    weight: 50,
    trait: 'Kind · 50 kg · kann steuern',
    flavor: 'Hat Nanuk das Pfötchengeben beigebracht.',
  },
];

export const iceDog: EntityDef = {
  id: 'nanuk',
  name: 'Nanuk',
  kind: 'dog',
  role: 'animal',
  canPilot: false,
  weight: 25,
  trait: 'Polarhund · 25 kg · kann nicht steuern',
  flavor: 'Wärmt jeden, der friert – und frisst jeden Keks.',
};

export const icePuzzle: PuzzleDefinition = {
  id: 'ice',
  entities: [...icePeople, iceDog],
  rules: [],
  vehicle: { capacity: 3, maxWeight: 100, requirePilot: true },
  roleLabels: {
    adult: { one: 'ein Erwachsener', many: '{n} Erwachsene' },
    child: { one: 'ein Kind', many: '{n} Kinder' },
    animal: { one: 'Nanuk', many: '{n} Tiere' },
  },
  cost: { type: 'crossings' },
  sides: [
    { name: 'Camp Nordlicht', at: 'bei Camp Nordlicht', to: 'zu Camp Nordlicht' },
    { name: 'Station Polaris', at: 'bei Station Polaris', to: 'zu Station Polaris' },
  ],
  vehicleNames: {
    name: 'Fährplattform',
    at: 'auf der Plattform',
    into: 'auf die Plattform',
    nom: 'die Fährplattform',
    acc: 'die Fährplattform',
    from: 'von der Fährplattform',
  },
};
