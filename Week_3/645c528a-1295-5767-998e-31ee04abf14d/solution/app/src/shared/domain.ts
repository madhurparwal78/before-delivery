/** Values the brief publishes, shared by the server and the browser so each is decided once. */

export type Mode = 'eight-ball' | 'nine-ball' | 'no-guidelines';
export type Pocket = 'top-left' | 'top-right' | 'middle-left' | 'middle-right' | 'bottom-left' | 'bottom-right';
export type Currency = 'coins' | 'cash';

export const MODES: readonly Mode[] = ['eight-ball', 'nine-ball', 'no-guidelines'];
export const POCKETS: readonly Pocket[] = ['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right'];
export const NO_GUIDELINES_MIN_LEVEL = 5;

export interface Tier {
  tier: number;
  name: string;
  minLevel: number;
  entry: number;
  pot: number;
}

export const TIERS: readonly Tier[] = [
  { tier: 1, name: 'Corner Bar', minLevel: 1, entry: 100, pot: 180 },
  { tier: 2, name: 'Back Room', minLevel: 3, entry: 500, pot: 900 },
  { tier: 3, name: 'Downtown', minLevel: 7, entry: 2500, pot: 4500 },
  { tier: 4, name: 'Velvet Room', minLevel: 12, entry: 10000, pot: 18000 },
  { tier: 5, name: 'The Penthouse', minLevel: 20, entry: 50000, pot: 90000 },
];

export const CLUB_CAPACITY = 50;
export const CLUB_FEE = 5000;
export const CLUB_MIN_LEVEL = 5;
export const PRESET_MESSAGES: readonly string[] = ['Good luck', 'Nice shot', 'Well played', 'Back soon', 'Ready to play?'];

export function xpToNext(level: number): number {
  return Math.round((level ** 1.5 * 100) / 10) * 10;
}

interface XpGain {
  level: number;
  xp: number;
  levelsReached: number[];
}

export function gainXp(level: number, xp: number, gained: number): XpGain {
  const levelsReached: number[] = [];
  let currentLevel = level;
  let progress = xp + gained;
  while (progress >= xpToNext(currentLevel)) {
    progress -= xpToNext(currentLevel);
    currentLevel += 1;
    levelsReached.push(currentLevel);
  }
  return { level: currentLevel, xp: progress, levelsReached };
}

export function matchXp(tier: number, won: boolean): number {
  return tier * (won ? 60 : 20);
}

interface PrizeSplit {
  first: number;
  second: number;
  semiFinal: number;
  house: number;
}

export function prizeSplit(entry: number): PrizeSplit {
  const pool = entry * 8;
  return { first: pool / 2, second: pool / 5, semiFinal: pool / 10, house: pool / 10 };
}

export function winRate(wins: number, losses: number): number {
  const played = wins + losses;
  return played === 0 ? 0 : Math.round((wins / played) * 1000) / 10;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function pocketName(pocket: Pocket): string {
  const words = pocket.split('-').join(' ');
  return words[0].toUpperCase() + words.slice(1);
}
