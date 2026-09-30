/**
 * Riverbound QA – Orakel-Leveldefinitionen, direkt aus docs/REQUIREMENTS.md abgeleitet.
 * Eigene, sprechende IDs; KEINE Übernahme von IDs oder Regeln aus `src/`.
 */
import type { OracleLevel } from './core';

const count = (s: ReadonlySet<string>, prefix: string) => [...s].filter((id) => id.startsWith(prefix)).length;

/**
 * LEVEL 1 – The Whispering Forest (Wolf-Ziege-Kohl).
 * „Spielfigur steuert das Boot; max. eine zusätzliche Einheit; Wolf nicht unbeaufsichtigt mit Ziege;
 *  Ziege nicht unbeaufsichtigt mit Kohl; Rückfahrten erlaubt.“
 * → Die Hüterin ist die einzige Pilotin, an Bord höchstens Hüterin + 1.
 */
export const L1_FOREST: OracleLevel = {
  id: 'forest',
  title: 'L1 Wolf-Ziege-Kohl',
  figures: [
    { id: 'hueterin', pilot: true },
    { id: 'wolf', pilot: false },
    { id: 'ziege', pilot: false },
    { id: 'kohl', pilot: false },
  ],
  maxAboard: 2,
  metric: 'crossings',
  bankViolation(s) {
    if (s.has('hueterin')) return null;
    if (s.has('wolf') && s.has('ziege')) return 'Der Wolf würde die Ziege fressen.';
    if (s.has('ziege') && s.has('kohl')) return 'Die Ziege würde den Kohl fressen.';
    return null;
  },
};

/**
 * LEVEL 2 – The Sunken Temple (Missionare-und-Kannibalen-Variante).
 * „Sobald Wächter auf einem Ufer vorhanden sind, dürfen Chaoswesen sie dort nicht zahlenmäßig übertreffen.
 *  Boot: max. zwei Figuren, darf nicht leer fahren. Validierung prüft beide Ufer gleichzeitig.“
 * Jede Figur darf steuern (keine Einschränkung im Auftrag).
 */
export const L2_TEMPLE: OracleLevel = {
  id: 'temple',
  title: 'L2 Wächter & Chaoswesen',
  figures: [
    { id: 'waechter1', pilot: true },
    { id: 'waechter2', pilot: true },
    { id: 'waechter3', pilot: true },
    { id: 'chaos1', pilot: true },
    { id: 'chaos2', pilot: true },
    { id: 'chaos3', pilot: true },
  ],
  maxAboard: 2,
  metric: 'crossings',
  bankViolation(s) {
    const g = count(s, 'waechter');
    const c = count(s, 'chaos');
    return g > 0 && c > g ? `${c} Chaoswesen gegen ${g} Wächter.` : null;
  },
};

/**
 * LEVEL 3 – Neon River (Bridge-and-Torch).
 * „A=1, B=2, C=5, D=8 Minuten. Limit 15 Minuten. Max. zwei Personen. Langsamere Person bestimmt Dauer.
 *  Energie-/Lichtquelle muss korrekt transportiert werden. Metrik = Gesamtzeit.“
 * Die Lichtquelle reist immer mit der Plattform (= Bootseite); jede Überfahrt braucht ≥ 1 Person.
 */
export const L3_NEON: OracleLevel = {
  id: 'neon',
  title: 'L3 Bridge-and-Torch',
  figures: [
    { id: 'A', pilot: true, minutes: 1 },
    { id: 'B', pilot: true, minutes: 2 },
    { id: 'C', pilot: true, minutes: 5 },
    { id: 'D', pilot: true, minutes: 8 },
  ],
  maxAboard: 2,
  metric: 'time',
  timeLimit: 15,
  bankViolation: () => null,
};

/** Regel L4: Companion nie mit fremdem Captain, solange der eigene Captain nicht dabei ist. */
function jealousViolation(s: ReadonlySet<string>): string | null {
  for (const i of [1, 2, 3]) {
    if (!s.has(`companion${i}`) || s.has(`captain${i}`)) continue;
    const foreign = [1, 2, 3].filter((j) => j !== i && s.has(`captain${j}`));
    if (foreign.length) return `companion${i} bei captain${foreign.join('+captain')} ohne captain${i}.`;
  }
  return null;
}

const HARBOR_FIGURES = [
  { id: 'captain1', pilot: true },
  { id: 'companion1', pilot: true },
  { id: 'captain2', pilot: true },
  { id: 'companion2', pilot: true },
  { id: 'captain3', pilot: true },
  { id: 'companion3', pilot: true },
] as const;

/**
 * LEVEL 4 – The Celestial Harbor (Jealous-Husbands-Variante), Regel auf Ufern UND im Boot.
 * „Eine Companion-Figur darf nicht gemeinsam mit einer fremden Captain-Figur auf einem Ufer zurückbleiben,
 *  solange ihre eigene Captain-Figur nicht ebenfalls dort ist. Boot max. zwei Personen.“
 * Die Spielumsetzung wendet die Regel zusätzlich im Boot an (QA-Auftrag: „auf Ufern UND im Boot“).
 */
export const L4_HARBOR: OracleLevel = {
  id: 'harbor',
  title: 'L4 Captains & Companions (Ufer + Boot)',
  figures: HARBOR_FIGURES,
  maxAboard: 2,
  metric: 'crossings',
  bankViolation: jealousViolation,
  boatViolation: jealousViolation,
};

/** Variante L4 nur mit Uferprüfung (wörtliche Lesart des Auftrags). */
export const L4_HARBOR_BANKS_ONLY: OracleLevel = {
  ...L4_HARBOR,
  id: 'harbor-banks-only',
  title: 'L4 Captains & Companions (nur Ufer)',
  boatViolation: undefined,
};

const ICE_HUMANS = [
  { id: 'erwachsener1', pilot: true, weight: 100 },
  { id: 'erwachsener2', pilot: true, weight: 100 },
  { id: 'kind1', pilot: true, weight: 50 },
  { id: 'kind2', pilot: true, weight: 50 },
] as const;

/**
 * LEVEL 5 – Aurora Icebound (Gewichtsrätsel), reine historische Variante ohne Hund.
 * „Erwachsener=100, Kind=50, Kapazität max. 100. Alle vier Menschen dürfen steuern.“
 * Maximale Figurenzahl 3 (Plattform), hier durch das Gewicht ohnehin auf 2 begrenzt.
 */
export const L5_ICE_PURE: OracleLevel = {
  id: 'ice-pure',
  title: 'L5 Gewicht (2 Erwachsene + 2 Kinder)',
  figures: ICE_HUMANS,
  maxAboard: 3,
  maxWeight: 100,
  metric: 'crossings',
  bankViolation: () => null,
};

/** L5 mit Polarhund (25 kg, kann nicht steuern) – so, wie das Spiel-Level ausgelegt ist. */
export const L5_ICE_DOG: OracleLevel = {
  ...L5_ICE_PURE,
  id: 'ice',
  title: 'L5 Gewicht + Polarhund (25 kg, steuert nicht)',
  figures: [...ICE_HUMANS, { id: 'hund', pilot: false, weight: 25 }],
};

/** Alle Orakel-Level (Hauptvarianten zuerst). */
export const ORACLE_LEVELS: readonly OracleLevel[] = [
  L1_FOREST,
  L2_TEMPLE,
  L3_NEON,
  L4_HARBOR,
  L4_HARBOR_BANKS_ONLY,
  L5_ICE_DOG,
  L5_ICE_PURE,
];
