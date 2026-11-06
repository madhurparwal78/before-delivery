import type { BuildingType, ResourceAmounts, Rotation, UnitKey } from './types.js';
import { ZERO_RESOURCES } from './types.js';

export const GRID_WIDTH = 40;
export const GRID_HEIGHT = 40;
export const BUILD_AREA_MIN = 2;
export const BUILD_AREA_MAX = 37;

export const BASE_STORAGE: ResourceAmounts = { brine: 2000, peat: 2000, copper: 200 };

export const MAX_LEVEL = 3;
export const SALTMARK_FOR_LEVEL: Record<number, number> = { 2: 5, 3: 15 };
export const LEVEL_3_COPPER_SURCHARGE = 200;

export const RAID_FINAL_TICK = 1800;
export const LAST_DEPLOY_TICK = 1799;

export type ProducerEffect = { resource: 'brine' | 'peat' | 'copper'; perHour: number; buffer: number };
export type StorageEffect = { resource: 'brine' | 'peat' | 'copper'; cap: number };
export type TowerEffect = { damage: number; rangeCells: number; intervalTicks: number };

export type BuildingSpec = {
  type: BuildingType;
  name: string;
  width: number;
  depth: number;
  maxCount: number;
  costs: readonly ResourceAmounts[];
  buildSeconds: readonly number[];
  hitPoints: readonly number[];
  producer?: readonly ProducerEffect[];
  storage?: readonly StorageEffect[];
  housing?: readonly number[];
  tower?: readonly TowerEffect[];
  trainsUnits?: boolean;
};

function cost(brine: number, peat: number, copper: number): ResourceAmounts {
  return { brine, peat, copper };
}

function levelCosts(perLevel: readonly ResourceAmounts[]): readonly ResourceAmounts[] {
  return perLevel.map((amounts, index) =>
    index === 2 ? { ...amounts, copper: amounts.copper + LEVEL_3_COPPER_SURCHARGE } : amounts
  );
}

export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  brine_pan: {
    type: 'brine_pan',
    name: 'Brine Pan',
    width: 3,
    depth: 3,
    maxCount: 4,
    costs: levelCosts([cost(0, 150, 0), cost(0, 600, 0), cost(0, 2000, 0)]),
    buildSeconds: [10, 60, 180],
    hitPoints: [400, 500, 650],
    producer: [
      { resource: 'brine', perHour: 600, buffer: 1000 },
      { resource: 'brine', perHour: 1200, buffer: 2500 },
      { resource: 'brine', perHour: 2000, buffer: 5000 }
    ]
  },
  peat_cutter: {
    type: 'peat_cutter',
    name: 'Peat Cutter',
    width: 2,
    depth: 3,
    maxCount: 4,
    costs: levelCosts([cost(150, 0, 0), cost(600, 0, 0), cost(2000, 0, 0)]),
    buildSeconds: [10, 60, 180],
    hitPoints: [400, 500, 650],
    producer: [
      { resource: 'peat', perHour: 600, buffer: 1000 },
      { resource: 'peat', perHour: 1200, buffer: 2500 },
      { resource: 'peat', perHour: 2000, buffer: 5000 }
    ]
  },
  copper_sluice: {
    type: 'copper_sluice',
    name: 'Copper Sluice',
    width: 2,
    depth: 3,
    maxCount: 2,
    costs: levelCosts([cost(500, 500, 0), cost(1500, 1500, 0), cost(3000, 3000, 0)]),
    buildSeconds: [20, 90, 240],
    hitPoints: [400, 500, 650],
    producer: [
      { resource: 'copper', perHour: 60, buffer: 200 },
      { resource: 'copper', perHour: 120, buffer: 400 },
      { resource: 'copper', perHour: 200, buffer: 800 }
    ]
  },
  brine_cistern: {
    type: 'brine_cistern',
    name: 'Brine Cistern',
    width: 3,
    depth: 3,
    maxCount: 2,
    costs: levelCosts([cost(0, 300, 0), cost(0, 1200, 0), cost(0, 3000, 0)]),
    buildSeconds: [10, 60, 180],
    hitPoints: [600, 800, 1000],
    storage: [
      { resource: 'brine', cap: 5000 },
      { resource: 'brine', cap: 12000 },
      { resource: 'brine', cap: 25000 }
    ]
  },
  peat_rick: {
    type: 'peat_rick',
    name: 'Peat Rick',
    width: 3,
    depth: 3,
    maxCount: 2,
    costs: levelCosts([cost(300, 0, 0), cost(1200, 0, 0), cost(3000, 0, 0)]),
    buildSeconds: [10, 60, 180],
    hitPoints: [600, 800, 1000],
    storage: [
      { resource: 'peat', cap: 5000 },
      { resource: 'peat', cap: 12000 },
      { resource: 'peat', cap: 25000 }
    ]
  },
  copper_vault: {
    type: 'copper_vault',
    name: 'Copper Vault',
    width: 3,
    depth: 3,
    maxCount: 1,
    costs: levelCosts([cost(1000, 1000, 0), cost(2500, 2500, 0), cost(5000, 5000, 0)]),
    buildSeconds: [30, 120, 300],
    hitPoints: [700, 900, 1100],
    storage: [
      { resource: 'copper', cap: 500 },
      { resource: 'copper', cap: 1200 },
      { resource: 'copper', cap: 2500 }
    ]
  },
  tide_barracks: {
    type: 'tide_barracks',
    name: 'Tide Barracks',
    width: 3,
    depth: 3,
    maxCount: 1,
    costs: levelCosts([cost(200, 0, 0), cost(800, 0, 0), cost(2500, 0, 0)]),
    buildSeconds: [10, 60, 180],
    hitPoints: [500, 650, 800],
    trainsUnits: true
  },
  driftwood_camp: {
    type: 'driftwood_camp',
    name: 'Driftwood Camp',
    width: 3,
    depth: 3,
    maxCount: 2,
    costs: levelCosts([cost(0, 200, 0), cost(0, 800, 0), cost(0, 2500, 0)]),
    buildSeconds: [10, 60, 180],
    hitPoints: [400, 500, 600],
    housing: [20, 30, 40]
  },
  kiln_tower: {
    type: 'kiln_tower',
    name: 'Kiln Tower',
    width: 3,
    depth: 3,
    maxCount: 3,
    costs: levelCosts([cost(300, 300, 0), cost(1000, 1000, 0), cost(2500, 2500, 0)]),
    buildSeconds: [15, 90, 240],
    hitPoints: [600, 750, 900],
    tower: [
      { damage: 40, rangeCells: 7, intervalTicks: 8 },
      { damage: 55, rangeCells: 7, intervalTicks: 8 },
      { damage: 70, rangeCells: 7, intervalTicks: 8 }
    ]
  }
};

export type UnitSpec = {
  unit: UnitKey;
  name: string;
  housing: number;
  cost: ResourceAmounts;
  trainSeconds: number;
  hitPoints: number;
  damage: number;
  intervalTicks: number;
  rangeMilli: number;
  speedMilli: number;
  barracksLevel: number;
};

export const UNITS: Record<UnitKey, UnitSpec> = {
  saltjack: {
    unit: 'saltjack',
    name: 'Saltjack',
    housing: 1,
    cost: { brine: 25, peat: 0, copper: 0 },
    trainSeconds: 5,
    hitPoints: 120,
    damage: 12,
    intervalTicks: 5,
    rangeMilli: 800,
    speedMilli: 15,
    barracksLevel: 1
  },
  peat_slinger: {
    unit: 'peat_slinger',
    name: 'Peat Slinger',
    housing: 1,
    cost: { brine: 40, peat: 0, copper: 0 },
    trainSeconds: 8,
    hitPoints: 50,
    damage: 9,
    intervalTicks: 6,
    rangeMilli: 3500,
    speedMilli: 18,
    barracksLevel: 2
  }
};

export function footprintAt(type: BuildingType, rotation: Rotation): { width: number; depth: number } {
  const spec = BUILDINGS[type];
  return rotation === 90 || rotation === 270
    ? { width: spec.depth, depth: spec.width }
    : { width: spec.width, depth: spec.depth };
}

export function levelCost(type: BuildingType, level: number): ResourceAmounts {
  const costs = BUILDINGS[type].costs[level - 1];
  return costs ?? ZERO_RESOURCES;
}

export function levelBuildSeconds(type: BuildingType, level: number): number {
  return BUILDINGS[type].buildSeconds[level - 1] ?? 0;
}

export function buildingHitPoints(type: BuildingType, level: number): number {
  return BUILDINGS[type].hitPoints[Math.max(0, level - 1)] ?? 0;
}

export function appliedSeconds(seconds: number, divisor: number): number {
  return Math.max(1, Math.ceil(seconds / divisor));
}

export function trainingCost(unit: UnitKey, count: number): ResourceAmounts {
  const base = UNITS[unit].cost;
  return { brine: base.brine * count, peat: base.peat * count, copper: base.copper * count };
}

export function isOnDeployRing(x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return false;
  return x <= 1 || y <= 1 || x >= GRID_WIDTH - 2 || y >= GRID_HEIGHT - 2;
}

export function fitsBuildArea(type: BuildingType, x: number, y: number, rotation: Rotation): boolean {
  const { width, depth } = footprintAt(type, rotation);
  return (
    x >= BUILD_AREA_MIN &&
    y >= BUILD_AREA_MIN &&
    x + width - 1 <= BUILD_AREA_MAX &&
    y + depth - 1 <= BUILD_AREA_MAX
  );
}

export function footprintsOverlap(
  a: { type: BuildingType; x: number; y: number; rotation: Rotation },
  b: { type: BuildingType; x: number; y: number; rotation: Rotation }
): boolean {
  const fa = footprintAt(a.type, a.rotation);
  const fb = footprintAt(b.type, b.rotation);
  return (
    a.x < b.x + fb.width && b.x < a.x + fa.width && a.y < b.y + fb.depth && b.y < a.y + fa.depth
  );
}

export function buildersTotal(saltmark: number): number {
  return Math.min(5, 2 + Math.floor(saltmark / 8));
}

export const LOOT_PERCENT = 20;

export function lootableFrom(balance: number): number {
  return Math.floor((balance * LOOT_PERCENT) / 100);
}
