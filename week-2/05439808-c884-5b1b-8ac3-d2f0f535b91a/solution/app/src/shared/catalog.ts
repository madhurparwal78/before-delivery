// The Saltreach catalog and domain vocabulary, shared by the server and the browser.

export const RESOURCES = ['brine', 'peat', 'copper'] as const;
export type Resource = (typeof RESOURCES)[number];

export const UNIT_KEYS = ['saltjack', 'peat_slinger'] as const;
export type UnitKey = (typeof UNIT_KEYS)[number];

export type Asset = Resource | UnitKey;
export type Amounts = Record<Resource, number>;
export type ArmyCounts = Record<UnitKey, number>;

export const BUILDING_TYPES = [
  'brine_pan',
  'peat_cutter',
  'copper_sluice',
  'brine_cistern',
  'peat_rick',
  'copper_vault',
  'tide_barracks',
  'driftwood_camp',
  'kiln_tower',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

export type RaidState = 'locked' | 'deploying' | 'resolved' | 'abandoned';
export type EndReason = 'finalized' | 'deadline_passed';
export type League = 'Mudflat' | 'Shingle' | 'Saltmarsh' | 'Tidewall';
export type ClanRole = 'skipper' | 'mate' | 'deckhand';
export type AccountRole = 'islander' | 'operator';
export type RequestState = 'open' | 'filled' | 'closed';
export type RaidRole = 'attack' | 'defence';

export const MAX_LEVEL = 3;
export const GRID_SIZE = 40;
export const BUILD_AREA_MIN = 2;
export const BUILD_AREA_MAX = 37;

type PerLevel = readonly [number, number, number];

interface BuildingSpec {
  type: BuildingType;
  name: string;
  width: number;
  depth: number;
  maxCount: number;
  cost: readonly [Amounts, Amounts, Amounts];
  buildSeconds: PerLevel;
  hp: PerLevel;
  producer?: { resource: Resource; perHour: PerLevel; buffer: PerLevel };
  storage?: { resource: Resource; cap: PerLevel };
  housing?: PerLevel;
  tower?: { damage: PerLevel; rangeMilli: number; interval: number };
  trains?: string;
}

const amounts = (brine: number, peat: number, copper = 0): Amounts => ({ brine, peat, copper });

export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  brine_pan: {
    type: 'brine_pan', name: 'Brine Pan', width: 3, depth: 3, maxCount: 4,
    cost: [amounts(0, 150), amounts(0, 600), amounts(0, 2000)],
    buildSeconds: [10, 60, 180], hp: [400, 500, 650],
    producer: { resource: 'brine', perHour: [600, 1200, 2000], buffer: [1000, 2500, 5000] },
  },
  peat_cutter: {
    type: 'peat_cutter', name: 'Peat Cutter', width: 2, depth: 3, maxCount: 4,
    cost: [amounts(150, 0), amounts(600, 0), amounts(2000, 0)],
    buildSeconds: [10, 60, 180], hp: [400, 500, 650],
    producer: { resource: 'peat', perHour: [600, 1200, 2000], buffer: [1000, 2500, 5000] },
  },
  copper_sluice: {
    type: 'copper_sluice', name: 'Copper Sluice', width: 2, depth: 3, maxCount: 2,
    cost: [amounts(500, 500), amounts(1500, 1500), amounts(3000, 3000)],
    buildSeconds: [20, 90, 240], hp: [400, 500, 650],
    producer: { resource: 'copper', perHour: [60, 120, 200], buffer: [200, 400, 800] },
  },
  brine_cistern: {
    type: 'brine_cistern', name: 'Brine Cistern', width: 3, depth: 3, maxCount: 2,
    cost: [amounts(0, 300), amounts(0, 1200), amounts(0, 3000)],
    buildSeconds: [10, 60, 180], hp: [600, 800, 1000],
    storage: { resource: 'brine', cap: [5000, 12000, 25000] },
  },
  peat_rick: {
    type: 'peat_rick', name: 'Peat Rick', width: 3, depth: 3, maxCount: 2,
    cost: [amounts(300, 0), amounts(1200, 0), amounts(3000, 0)],
    buildSeconds: [10, 60, 180], hp: [600, 800, 1000],
    storage: { resource: 'peat', cap: [5000, 12000, 25000] },
  },
  copper_vault: {
    type: 'copper_vault', name: 'Copper Vault', width: 3, depth: 3, maxCount: 1,
    cost: [amounts(1000, 1000), amounts(2500, 2500), amounts(5000, 5000)],
    buildSeconds: [30, 120, 300], hp: [700, 900, 1100],
    storage: { resource: 'copper', cap: [500, 1200, 2500] },
  },
  tide_barracks: {
    type: 'tide_barracks', name: 'Tide Barracks', width: 3, depth: 3, maxCount: 1,
    cost: [amounts(200, 0), amounts(800, 0), amounts(2500, 0)],
    buildSeconds: [10, 60, 180], hp: [500, 650, 800],
    trains: 'L1 trains Saltjacks, L2 and up also Peat Slingers',
  },
  driftwood_camp: {
    type: 'driftwood_camp', name: 'Driftwood Camp', width: 3, depth: 3, maxCount: 2,
    cost: [amounts(0, 200), amounts(0, 800), amounts(0, 2500)],
    buildSeconds: [10, 60, 180], hp: [400, 500, 600],
    housing: [20, 30, 40],
  },
  kiln_tower: {
    type: 'kiln_tower', name: 'Kiln Tower', width: 3, depth: 3, maxCount: 3,
    cost: [amounts(300, 300), amounts(1000, 1000), amounts(2500, 2500)],
    buildSeconds: [15, 90, 240], hp: [600, 750, 900],
    tower: { damage: [40, 55, 70], rangeMilli: 7000, interval: 8 },
  },
};

interface UnitSpec {
  key: UnitKey;
  name: string;
  housing: number;
  cost: Amounts;
  trainSeconds: number;
  hp: number;
  damage: number;
  interval: number;
  rangeMilli: number;
  speedMilli: number;
  barracksLevel: number;
}

export const UNITS: Record<UnitKey, UnitSpec> = {
  saltjack: {
    key: 'saltjack', name: 'Saltjack', housing: 1, cost: amounts(25, 0), trainSeconds: 5,
    hp: 120, damage: 12, interval: 5, rangeMilli: 800, speedMilli: 15, barracksLevel: 1,
  },
  peat_slinger: {
    key: 'peat_slinger', name: 'Peat Slinger', housing: 1, cost: amounts(40, 0), trainSeconds: 8,
    hp: 50, damage: 9, interval: 6, rangeMilli: 3500, speedMilli: 18, barracksLevel: 2,
  },
};

const LEVEL_THREE_COPPER = 200;

/** The full cost of the job that takes a building to `level`. */
export function levelCost(type: BuildingType, level: number): Amounts {
  const base = BUILDINGS[type].cost[level - 1] as Amounts;
  return level === MAX_LEVEL ? { ...base, copper: base.copper + LEVEL_THREE_COPPER } : { ...base };
}

/** The island saltmark a building needs before it may be upgraded to `level`. */
export function saltmarkThreshold(level: number): number {
  return level === 3 ? 15 : level === 2 ? 5 : 0;
}

/** Every applied build or training duration: published seconds ÷ divisor, rounded up, at least 1. */
export function appliedSeconds(published: number, divisor: number): number {
  return Math.max(1, Math.ceil(published / divisor));
}

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && (BUILDING_TYPES as readonly string[]).includes(value);
}

export function isUnitKey(value: unknown): value is UnitKey {
  return typeof value === 'string' && (UNIT_KEYS as readonly string[]).includes(value);
}

export function isRotation(value: unknown): value is Rotation {
  return typeof value === 'number' && (ROTATIONS as readonly number[]).includes(value);
}

export const zeroAmounts = (): Amounts => ({ brine: 0, peat: 0, copper: 0 });
