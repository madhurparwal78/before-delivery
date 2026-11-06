import type {
  BuildingSpec,
  BuildingType,
  League,
  ResourceAmounts,
  UnitKey,
  UnitSpec,
} from './types.ts';

const ZERO: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };

function amounts(brine = 0, peat = 0, copper = 0): ResourceAmounts {
  return { brine, peat, copper };
}

function spec(
  type: BuildingType,
  name: string,
  width: number,
  depth: number,
  maxCount: number,
  levels: [{ cost: ResourceAmounts; buildSeconds: number; hp: number }, { cost: ResourceAmounts; buildSeconds: number; hp: number }, { cost: ResourceAmounts; buildSeconds: number; hp: number }],
  extra: Partial<BuildingSpec> = {}
): BuildingSpec {
  return { type, name, width, depth, maxCount, levels, ...extra };
}

export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  brine_pan: spec('brine_pan', 'Brine Pan', 3, 3, 4, [
    { cost: amounts(0, 150), buildSeconds: 10, hp: 400 },
    { cost: amounts(0, 600), buildSeconds: 60, hp: 500 },
    { cost: amounts(0, 2000), buildSeconds: 180, hp: 650 },
  ], { producer: { ratePerHour: [600, 1200, 2000], buffer: [1000, 2500, 5000], resource: 'brine' } }),
  peat_cutter: spec('peat_cutter', 'Peat Cutter', 2, 3, 4, [
    { cost: amounts(150), buildSeconds: 10, hp: 400 },
    { cost: amounts(600), buildSeconds: 60, hp: 500 },
    { cost: amounts(2000), buildSeconds: 180, hp: 650 },
  ], { producer: { ratePerHour: [600, 1200, 2000], buffer: [1000, 2500, 5000], resource: 'peat' } }),
  copper_sluice: spec('copper_sluice', 'Copper Sluice', 2, 3, 2, [
    { cost: amounts(500, 500), buildSeconds: 20, hp: 400 },
    { cost: amounts(1500, 1500), buildSeconds: 90, hp: 500 },
    { cost: amounts(3000, 3000), buildSeconds: 240, hp: 650 },
  ], { producer: { ratePerHour: [60, 120, 200], buffer: [200, 400, 800], resource: 'copper' } }),
  brine_cistern: spec('brine_cistern', 'Brine Cistern', 3, 3, 2, [
    { cost: amounts(0, 300), buildSeconds: 10, hp: 600 },
    { cost: amounts(0, 1200), buildSeconds: 60, hp: 800 },
    { cost: amounts(0, 3000), buildSeconds: 180, hp: 1000 },
  ], { storage: { resource: 'brine', cap: [5000, 12000, 25000] } }),
  peat_rick: spec('peat_rick', 'Peat Rick', 3, 3, 2, [
    { cost: amounts(300), buildSeconds: 10, hp: 600 },
    { cost: amounts(1200), buildSeconds: 60, hp: 800 },
    { cost: amounts(3000), buildSeconds: 180, hp: 1000 },
  ], { storage: { resource: 'peat', cap: [5000, 12000, 25000] } }),
  copper_vault: spec('copper_vault', 'Copper Vault', 3, 3, 1, [
    { cost: amounts(1000, 1000), buildSeconds: 30, hp: 700 },
    { cost: amounts(2500, 2500), buildSeconds: 120, hp: 900 },
    { cost: amounts(5000, 5000), buildSeconds: 300, hp: 1100 },
  ], { storage: { resource: 'copper', cap: [500, 1200, 2500] } }),
  tide_barracks: spec('tide_barracks', 'Tide Barracks', 3, 3, 1, [
    { cost: amounts(200), buildSeconds: 10, hp: 500 },
    { cost: amounts(800), buildSeconds: 60, hp: 650 },
    { cost: amounts(2500), buildSeconds: 180, hp: 800 },
  ], { trainsUnits: true }),
  driftwood_camp: spec('driftwood_camp', 'Driftwood Camp', 3, 3, 2, [
    { cost: amounts(0, 200), buildSeconds: 10, hp: 400 },
    { cost: amounts(0, 800), buildSeconds: 60, hp: 500 },
    { cost: amounts(0, 2500), buildSeconds: 180, hp: 600 },
  ], { housing: [20, 30, 40] }),
  kiln_tower: spec('kiln_tower', 'Kiln Tower', 3, 3, 3, [
    { cost: amounts(300, 300), buildSeconds: 15, hp: 600 },
    { cost: amounts(1000, 1000), buildSeconds: 90, hp: 750 },
    { cost: amounts(2500, 2500), buildSeconds: 240, hp: 900 },
  ], { tower: { damage: [40, 55, 70], rangeCells: 7, intervalTicks: 8 } }),
};

export const UNITS: Record<UnitKey, UnitSpec> = {
  saltjack: {
    key: 'saltjack', name: 'Saltjack', housing: 1, cost: amounts(25), trainSeconds: 5,
    hp: 120, damage: 12, intervalTicks: 5, rangeThousandths: 800, speedThousandths: 15,
  },
  peat_slinger: {
    key: 'peat_slinger', name: 'Peat Slinger', housing: 1, cost: amounts(40), trainSeconds: 8,
    hp: 50, damage: 9, intervalTicks: 6, rangeThousandths: 3500, speedThousandths: 18,
  },
};

export const BUILDING_ORDER: BuildingType[] = [
  'brine_pan', 'peat_cutter', 'copper_sluice', 'brine_cistern', 'peat_rick',
  'copper_vault', 'tide_barracks', 'driftwood_camp', 'kiln_tower',
];

export const BASE_STORAGE: ResourceAmounts = { brine: 2000, peat: 2000, copper: 200 };

export function levelCost(type: BuildingType, level: number): ResourceAmounts {
  // level is 1-based; every upgrade to level 3 adds 200 copper on top of the listed cost
  const base = BUILDINGS[type].levels[level - 1].cost;
  const copper = level === 3 ? base.copper + 200 : base.copper;
  return { brine: base.brine, peat: base.peat, copper };
}

export function appliedSeconds(seconds: number, divisor: number): number {
  return Math.max(1, Math.ceil(seconds / divisor));
}

export function buildingHp(type: BuildingType, level: number): number {
  return BUILDINGS[type].levels[level - 1].hp;
}

export function footprintAt(type: BuildingType, rotation: number): { width: number; depth: number } {
  const { width, depth } = BUILDINGS[type];
  return rotation === 90 || rotation === 270 ? { width: depth, depth: width } : { width, depth };
}

export function producersOf(): BuildingSpec[] {
  return BUILDING_ORDER.map((t) => BUILDINGS[t]).filter((b) => b.producer);
}

export function leagueFor(trophies: number): League {
  if (trophies >= 1200) return 'Tidewall';
  if (trophies >= 800) return 'Saltmarsh';
  if (trophies >= 400) return 'Shingle';
  return 'Mudflat';
}

export function lootableFrom(balance: number): number {
  return Math.floor((balance * 20) / 100);
}

export function buildersTotal(saltmark: number): number {
  return Math.min(5, 2 + Math.floor(saltmark / 8));
}

export function leagueBonus(league: League): ResourceAmounts {
  switch (league) {
    case 'Tidewall': return amounts(5000, 5000, 300);
    case 'Saltmarsh': return amounts(3000, 3000, 100);
    case 'Shingle': return amounts(2000, 2000, 50);
    default: return amounts(1000, 1000);
  }
}

export const DAILY_CHESTS: ResourceAmounts[] = [
  amounts(300, 300),
  amounts(400, 400),
  amounts(500, 500, 20),
  amounts(600, 600, 30),
  amounts(700, 700, 40),
  amounts(800, 800, 50),
  amounts(1000, 1000, 100),
];

export const SALTMARK_THRESHOLDS: Record<number, number> = { 2: 5, 3: 15 };
export const ZERO_AMOUNTS: ResourceAmounts = ZERO;
