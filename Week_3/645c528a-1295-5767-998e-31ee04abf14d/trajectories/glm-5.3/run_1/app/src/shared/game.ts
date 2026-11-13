import type { Mode, PocketName } from './types.js';

export interface Tier {
  id: number;
  name: string;
  minLevel: number;
  entry: number;
  pot: number;
}

export const TIERS: readonly Tier[] = [
  { id: 1, name: 'Corner Bar', minLevel: 1, entry: 100, pot: 180 },
  { id: 2, name: 'Back Room', minLevel: 3, entry: 500, pot: 900 },
  { id: 3, name: 'Downtown', minLevel: 7, entry: 2500, pot: 4500 },
  { id: 4, name: 'Velvet Room', minLevel: 12, entry: 10000, pot: 18000 },
  { id: 5, name: 'The Penthouse', minLevel: 20, entry: 50000, pot: 90000 },
] as const;

export function tierById(id: number): Tier {
  const tier = TIERS.find((t) => t.id === id);
  if (!tier) throw new Error(`unknown tier ${id}`);
  return tier;
}

export function xpToNext(level: number): number {
  return Math.round(Math.pow(level, 1.5) * 100 / 10) * 10;
}

export function matchXp(tier: number, won: boolean): number {
  return tier * (won ? 60 : 20);
}

export const HOUSE_CUT_NUMERATOR = 1;
export const HOUSE_CUT_DENOMINATOR = 10;

export const POCKET_NAMES: readonly PocketName[] = [
  'top-left',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-right',
] as const;

export const POCKET_LABELS: readonly { name: PocketName; label: string }[] = [
  { name: 'top-left', label: 'Top left' },
  { name: 'top-right', label: 'Top right' },
  { name: 'middle-left', label: 'Middle left' },
  { name: 'middle-right', label: 'Middle right' },
  { name: 'bottom-left', label: 'Bottom left' },
  { name: 'bottom-right', label: 'Bottom right' },
] as const;

export const NO_GUIDELINES_UNLOCK_LEVEL = 5;
export const CLUB_CREATE_LEVEL = 5;
export const CLUB_CREATE_COINS = 5000;
export const CLUB_CAPACITY = 50;
export const DAILY_REWARD_COINS = 100;
export const REFILL_COINS = 500;
export const REFILLS_PER_DAY = 3;
export const REFILL_THRESHOLD = 100;
export const SIGNUP_GRANT_COINS = 1000;
export const LEVEL_UP_CASH = 5;
export const TOURNAMENT_SIZE = 8;
export const CUE_STAT_MAX = { aim: 25, power: 10, spin: 15, time: 3 };

export function tournamentPool(tierId: number): number {
  return tierById(tierId).entry * TOURNAMENT_SIZE;
}

export function tournamentPrizes(tierId: number): { first: number; second: number; semiFinal: number; house: number } {
  const pool = tournamentPool(tierId);
  return { first: Math.round(pool * 0.5), second: Math.round(pool * 0.2), semiFinal: Math.round(pool * 0.1), house: Math.round(pool * 0.1) };
}

export type TableKind = 'stake' | 'private' | 'tournament' | 'grading';

export interface TableSpec {
  mode: Mode;
  tier: number;
  kind: TableKind;
}

export function formatted(n: number): string {
  return n.toLocaleString('en-US');
}
