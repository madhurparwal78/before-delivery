export const RESOURCES = ['brine', 'peat', 'copper'] as const;
export type Resource = (typeof RESOURCES)[number];
export type ResourceAmounts = Record<Resource, number>;

export const UNIT_KEYS = ['saltjack', 'peat_slinger'] as const;
export type UnitKey = (typeof UNIT_KEYS)[number];
export type UnitCounts = Record<UnitKey, number>;

export const BUILDING_TYPES = [
  'brine_pan',
  'peat_cutter',
  'copper_sluice',
  'brine_cistern',
  'peat_rick',
  'copper_vault',
  'tide_barracks',
  'driftwood_camp',
  'kiln_tower'
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export type Rotation = 0 | 90 | 180 | 270;

export type RaidState = 'locked' | 'deploying' | 'resolved' | 'abandoned';
export type RaidEndReason = 'finalized' | 'deadline_passed';

export const LEAGUES = ['Mudflat', 'Shingle', 'Saltmarsh', 'Tidewall'] as const;
export type League = (typeof LEAGUES)[number];

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

export type LedgerAsset = Resource | UnitKey;

export type RequestState = 'open' | 'filled' | 'closed';

export const ZERO_RESOURCES: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };

export function isUnitKey(value: string): value is UnitKey {
  return (UNIT_KEYS as readonly string[]).includes(value);
}

export function isBuildingType(value: string): value is BuildingType {
  return (BUILDING_TYPES as readonly string[]).includes(value);
}

export function isRotation(value: number): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

export function leagueFor(trophies: number): League {
  if (trophies >= 1200) return 'Tidewall';
  if (trophies >= 800) return 'Saltmarsh';
  if (trophies >= 400) return 'Shingle';
  return 'Mudflat';
}
