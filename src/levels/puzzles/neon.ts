import type { PuzzleDefinition } from '../../puzzle/types';

/**
 * LEVEL 3 – Neon River / Midnight Circuit: bridge-and-torch.
 * The hover platform only moves with its energy cell (the "torch"); the cell always travels
 * with the platform, so the platform side equals the torch side. Two couriers maximum;
 * a shared crossing takes as long as the slower courier needs to keep the platform stable.
 */
export const neonPuzzle: PuzzleDefinition = {
  id: 'neon',
  entities: [
    {
      id: 'nova',
      name: 'Nova',
      kind: 'courier',
      role: 'courier',
      canPilot: true,
      crossTime: 1,
      trait: 'Sprint-Kurierin · Überfahrt: 1 Min',
      flavor: 'Magnetstiefel, Reflexe wie ein Blitz.',
    },
    {
      id: 'kai',
      name: 'Kai',
      kind: 'courier',
      role: 'courier',
      canPilot: true,
      crossTime: 2,
      trait: 'Drohnen-Techniker · Überfahrt: 2 Min',
      flavor: 'Fliegt lieber, als dass er läuft.',
    },
    {
      id: 'mara',
      name: 'Mara',
      kind: 'courier',
      role: 'courier',
      canPilot: true,
      crossTime: 5,
      trait: 'Netz-Ingenieurin mit Kabeltrommel · Überfahrt: 5 Min',
      flavor: 'Schleppt 30 kg Glasfaser durch den Regen.',
    },
    {
      id: 'oskar',
      name: 'Oskar',
      kind: 'courier',
      role: 'courier',
      canPilot: true,
      crossTime: 8,
      trait: 'Veteran im Exo-Rahmen · Überfahrt: 8 Min',
      flavor: 'Hat jede Brücke dieser Stadt gebaut – und kennt jedes Knie.',
    },
  ],
  rules: [],
  vehicle: { capacity: 2, requirePilot: true },
  cost: { type: 'slowest', attribute: 'crossTime', limit: 15, unit: 'Min' },
  sides: [
    { name: 'Pier 9', at: 'an Pier 9', to: 'zu Pier 9' },
    { name: 'Arkologie-Dock', at: 'am Arkologie-Dock', to: 'zum Arkologie-Dock' },
  ],
  vehicleNames: {
    name: 'Schwebeplattform',
    at: 'auf der Plattform',
    into: 'auf die Plattform',
    nom: 'die Plattform',
    acc: 'die Plattform',
    from: 'von der Plattform',
  },
};
