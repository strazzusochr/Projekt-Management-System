/**
 * Declarative puzzle model for the river-crossing family.
 *
 * A level is described purely as data (entities, rules, vehicle rules, cost model, goal).
 * The engine compiles this into bitmask operations; the solver explores the state space.
 * Nothing here knows about rendering.
 */

/** 0 = start bank ("left"), 1 = goal bank ("right"). */
export type Side = 0 | 1;

/** German grammatical forms used to build readable messages and hints. */
export interface GrammarForms {
  /** Nominative, e.g. "der Wolf" / "Mira". */
  nom: string;
  /** Accusative, e.g. "den Wolf". */
  acc: string;
  /** Dative, e.g. "dem Wolf". */
  dat: string;
}

export interface EntityDef {
  id: string;
  /** Short display name, e.g. "Wolf" or "Mira". */
  name: string;
  /** Grammar forms; default to `name` for proper names. */
  forms?: Partial<GrammarForms>;
  /** Free-form kind used by the presentation layer (wolf, goat, guardian, courier …). */
  kind: string;
  /** Role used by rule selectors (e.g. 'guardian', 'chaos', 'captain', 'companion', 'adult', 'child'). */
  role?: string;
  /** Additional selector tags. */
  tags?: string[];
  canPilot?: boolean;
  weight?: number;
  /** Crossing duration for the `slowest` cost model. */
  crossTime?: number;
  /** Couples share a pairId. */
  pairId?: string;
  /** Short property line shown in the hover tooltip, e.g. "Kann das Boot steuern". */
  trait: string;
  /** Optional flavour line for the tooltip. */
  flavor?: string;
}

/** Selects a set of entities. All given criteria are OR-combined. */
export interface SelectorDef {
  ids?: string[];
  role?: string;
  kind?: string;
  tag?: string;
}

export type RuleScope = 'banks' | 'banksAndVehicle';

interface RuleBase {
  id: string;
  /** Where the rule is evaluated. Default: 'banks'. */
  scope?: RuleScope;
  /** Short title shown above the explanation, e.g. "Gefahr am Ufer". */
  title: string;
  /** One-line rule description for the rules panel. */
  summary: string;
  /** Symbol hint for the UI (not colour-only feedback). */
  icon?: string;
}

/**
 * Members of `a` and `b` must not share a location unless a member of `unlessPresent` is there too.
 * Message placeholders: {a} {b} (nominative names), {aAcc} {bAcc}, {loc} ("am Westufer"/"im Boot"),
 * {guard} (nominative of first supervisor).
 */
export interface ForbiddenTogetherRule extends RuleBase {
  type: 'forbiddenTogether';
  a: SelectorDef;
  b: SelectorDef;
  unlessPresent?: SelectorDef;
  message: string;
}

/**
 * Wherever at least one member of `protectedGroup` is present, the number of `threatGroup`
 * members must not exceed the number of protected members.
 * Placeholders: {loc} {threatCount} {protectedCount} {threatNames} {protectedNames}.
 */
export interface NoOutnumberRule extends RuleBase {
  type: 'noOutnumber';
  protectedGroup: SelectorDef;
  threatGroup: SelectorDef;
  message: string;
}

/**
 * A ward must not share a location with a guard of a different pair unless the ward's own guard
 * (same pairId) is present too.
 * Placeholders: {ward} {foreign} (names of foreign guards), {own} (own guard), {loc}.
 */
export interface PairGuardRule extends RuleBase {
  type: 'pairGuard';
  wards: SelectorDef;
  guards: SelectorDef;
  message: string;
}

export type RuleDef = ForbiddenTogetherRule | NoOutnumberRule | PairGuardRule;

export interface VehicleRules {
  /** Maximum number of entities aboard (including the pilot). */
  capacity: number;
  /** Optional weight limit (sum of entity weights). */
  maxWeight?: number;
  /** A crossing needs at least one entity with canPilot aboard. */
  requirePilot: boolean;
  /** Pilots that never leave the vehicle in the UI (e.g. the ferry keeper). Purely presentational. */
  stickyPilots?: string[];
}

export type CostModel =
  | { type: 'crossings' }
  | {
      /** Each crossing costs the maximum `attribute` value of the group (bridge-and-torch). */
      type: 'slowest';
      attribute: 'crossTime';
      /** Total budget; crossings that would exceed it are rejected. */
      limit?: number;
      unit: string;
    };

export interface LocationNames {
  /** "Westufer" */
  name: string;
  /** "am Westufer" */
  at: string;
  /** "zum Westufer" */
  to: string;
}

export interface VehicleNames {
  /** "Boot" */
  name: string;
  /** "im Boot" */
  at: string;
  /** "ins Boot" */
  into: string;
  /** "das Boot" (nominative with article) */
  nom: string;
  /** "das Boot" / "den Shuttle" (accusative with article) */
  acc: string;
  /** "aus dem Boot" / "von der Plattform" */
  from: string;
}

export interface PuzzleDefinition {
  id: string;
  entities: EntityDef[];
  rules: RuleDef[];
  vehicle: VehicleRules;
  cost: CostModel;
  sides: [LocationNames, LocationNames];
  vehicleNames: VehicleNames;
  /** Start configuration. Default: everything (and the vehicle) on side 0. */
  start?: { vehicleSide?: Side; entitySides?: Record<string, Side> };
  /** Goal. Default: all entities on side 1. */
  goal?: { side: Side; entities?: string[] };
  /**
   * Labels used by the hint generator to describe a group without naming individuals
   * (hint level 2). `one` = "ein Wächter", `many` = "{n} Wächter".
   */
  roleLabels?: Record<string, { one: string; many: string }>;
}

/** Where a rule violation happens. */
export type Location = Side | 'vehicle';

export type ViolationKind =
  | 'rule'
  | 'empty'
  | 'capacity'
  | 'weight'
  | 'noPilot'
  | 'notAtVehicle'
  | 'timeLimit'
  | 'busy'
  | 'won';

export interface Violation {
  kind: ViolationKind;
  ruleId?: string;
  location?: Location;
  /** Entity ids involved (for highlighting / camera focus). */
  entities: string[];
  title: string;
  message: string;
  icon?: string;
}

/** A crossing: bitmask of the entities travelling together. */
export interface CrossingAction {
  group: number;
  /** Direction the vehicle travels to. */
  to: Side;
  cost: number;
}
