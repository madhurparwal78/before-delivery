export type ResourceKey = 'brine' | 'peat' | 'copper';
export type AssetKey = ResourceKey | 'saltjack' | 'peat_slinger';
export type UnitKey = 'saltjack' | 'peat_slinger';
export type BuildingType =
  | 'brine_pan'
  | 'peat_cutter'
  | 'copper_sluice'
  | 'brine_cistern'
  | 'peat_rick'
  | 'copper_vault'
  | 'tide_barracks'
  | 'driftwood_camp'
  | 'kiln_tower';
export type RaidState = 'locked' | 'deploying' | 'resolved' | 'abandoned';
export type RaidEndReason = null | 'finalized' | 'deadline_passed';
export type League = 'Mudflat' | 'Shingle' | 'Saltmarsh' | 'Tidewall';
export type ClanRole = 'skipper' | 'mate' | 'deckhand';
export type AccountRole = 'islander' | 'operator';
export type LedgerKind =
  | 'starter'
  | 'production'
  | 'build_spend'
  | 'refund'
  | 'train_spend'
  | 'train_complete'
  | 'raid_loot'
  | 'raid_deploy'
  | 'star_bonus'
  | 'daily_chest'
  | 'league_bonus'
  | 'donation';
export type BuildingJobKind = 'construction' | 'upgrade';

export interface ResourceAmounts {
  brine: number;
  peat: number;
  copper: number;
}

export interface BuildingLevelSpec {
  cost: ResourceAmounts;
  buildSeconds: number;
  hp: number;
}

export interface BuildingSpec {
  type: BuildingType;
  name: string;
  width: number;
  depth: number;
  maxCount: number;
  levels: [BuildingLevelSpec, BuildingLevelSpec, BuildingLevelSpec];
  producer?: { ratePerHour: number[]; buffer: number[]; resource: ResourceKey };
  storage?: { resource: ResourceKey; cap: number[] };
  housing?: number[];
  trainsUnits?: boolean;
  tower?: { damage: number[]; rangeCells: number; intervalTicks: number };
}

export interface UnitSpec {
  key: UnitKey;
  name: string;
  housing: number;
  cost: ResourceAmounts;
  trainSeconds: number;
  hp: number;
  damage: number;
  intervalTicks: number;
  rangeThousandths: number;
  speedThousandths: number;
}

export interface DeployEntry {
  tick: number;
  unit: UnitKey;
  x: number;
  y: number;
}

export interface LayoutBuilding {
  index: number;
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: number;
  level: number;
  hp: number;
}

export interface SimUnitState {
  index: number;
  unit: UnitKey;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

export interface TickState {
  tick: number;
  destruction: number;
  stars: number;
  loot: ResourceAmounts;
  buildings: { index: number; hp: number; destroyed: boolean }[];
  units: SimUnitState[];
  hash: string;
}

export interface BattleResult {
  finalTick: number;
  destruction: number;
  stars: number;
  loot: ResourceAmounts;
  ticks: TickState[];
}

export const GRID_SIZE = 40;
export const BUILD_MIN = 2;
export const BUILD_MAX = 37;
export const MAX_ID = 9_007_199_254_740_991;
export const RAID_WINDOW_TICKS = 1_800;
