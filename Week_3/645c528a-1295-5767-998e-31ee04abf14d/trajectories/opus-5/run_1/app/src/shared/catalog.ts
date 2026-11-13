export interface Tier {
  tier: number;
  name: string;
  minLevel: number;
  entry: number;
  pot: number;
}

export const TIERS: Tier[] = [
  { tier: 1, name: 'Corner Bar', minLevel: 1, entry: 100, pot: 180 },
  { tier: 2, name: 'Back Room', minLevel: 3, entry: 500, pot: 900 },
  { tier: 3, name: 'Downtown', minLevel: 7, entry: 2500, pot: 4500 },
  { tier: 4, name: 'Velvet Room', minLevel: 12, entry: 10000, pot: 18000 },
  { tier: 5, name: 'The Penthouse', minLevel: 20, entry: 50000, pot: 90000 },
];

export function tierOf(tier: number): Tier {
  const found = TIERS.find((t) => t.tier === tier);
  if (!found) throw new Error(`unknown tier ${tier}`);
  return found;
}

export function xpToLeaveLevel(level: number): number {
  return Math.round((100 * Math.pow(level, 1.5)) / 10) * 10;
}

export function applyXp(level: number, xp: number, gained: number): { level: number; xp: number; levelUps: number[] } {
  let nextLevel = level;
  let nextXp = xp + gained;
  const levelUps: number[] = [];
  while (nextXp >= xpToLeaveLevel(nextLevel)) {
    nextXp -= xpToLeaveLevel(nextLevel);
    nextLevel += 1;
    levelUps.push(nextLevel);
  }
  return { level: nextLevel, xp: nextXp, levelUps };
}

export function tournamentPrizes(entry: number): {
  first: number;
  second: number;
  semiFinal: number;
  house: number;
} {
  const pool = entry * 8;
  return {
    first: pool / 2,
    second: pool / 5,
    semiFinal: pool / 10,
    house: pool / 10,
  };
}

export interface ShopItemDef {
  id: string;
  kind: 'cue' | 'cloth';
  name: string;
  currency: 'coins' | 'cash';
  price: number;
  minLevel: number;
  aim: number;
  power: number;
  spin: number;
  time: number;
}

export const SHOP_ITEMS: ShopItemDef[] = [
  { id: 'cue-starter', kind: 'cue', name: 'Starter Cue', currency: 'coins', price: 0, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cue-ash-break', kind: 'cue', name: 'Ash Break', currency: 'coins', price: 400, minLevel: 1, aim: 5, power: 2, spin: 0, time: 0 },
  { id: 'cue-copper-ferrule', kind: 'cue', name: 'Copper Ferrule', currency: 'coins', price: 1500, minLevel: 3, aim: 10, power: 3, spin: 5, time: 1 },
  { id: 'cue-night-maple', kind: 'cue', name: 'Night Maple', currency: 'coins', price: 6000, minLevel: 7, aim: 15, power: 6, spin: 8, time: 1 },
  { id: 'cue-velvet-taper', kind: 'cue', name: 'Velvet Taper', currency: 'coins', price: 20000, minLevel: 12, aim: 20, power: 8, spin: 12, time: 2 },
  { id: 'cue-long-rail-master', kind: 'cue', name: 'Long Rail Master', currency: 'coins', price: 75000, minLevel: 20, aim: 25, power: 10, spin: 15, time: 3 },
  { id: 'cue-brass-inlay', kind: 'cue', name: 'Brass Inlay', currency: 'cash', price: 40, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cue-lamp-black', kind: 'cue', name: 'Lamp Black', currency: 'cash', price: 90, minLevel: 3, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cloth-hall-blue', kind: 'cloth', name: 'Hall Blue', currency: 'cash', price: 0, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cloth-oxblood', kind: 'cloth', name: 'Oxblood', currency: 'cash', price: 30, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cloth-moss', kind: 'cloth', name: 'Moss', currency: 'cash', price: 30, minLevel: 1, aim: 0, power: 0, spin: 0, time: 0 },
  { id: 'cloth-brass-felt', kind: 'cloth', name: 'Brass Felt', currency: 'cash', price: 60, minLevel: 5, aim: 0, power: 0, spin: 0, time: 0 },
];

export function itemOf(id: string): ShopItemDef | undefined {
  return SHOP_ITEMS.find((i) => i.id === id);
}

export interface CashPackDef {
  id: string;
  name: string;
  cash: number;
  priceUsd: string;
}

export const CASH_PACKS: CashPackDef[] = [
  { id: 'pack-chalk', name: 'Chalk Pack', cash: 50, priceUsd: '0.99' },
  { id: 'pack-rack', name: 'Rack Pack', cash: 120, priceUsd: '1.99' },
  { id: 'pack-hall', name: 'Hall Pack', cash: 300, priceUsd: '4.99' },
];

export const STARTER_CUE_ID = 'cue-starter';
export const STARTER_CLOTH_ID = 'cloth-hall-blue';
export const SIGNUP_GRANT = 1000;
export const DAILY_REWARD = 100;
export const REFILL_AMOUNT = 500;
export const REFILL_LIMIT = 3;
export const REFILL_THRESHOLD = 100;
export const CLUB_CAPACITY = 50;
export const CLUB_FEE = 5000;
export const CLUB_MIN_LEVEL = 5;
export const NO_GUIDELINES_MIN_LEVEL = 5;
