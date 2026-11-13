import { CONFIG } from '../config.js';

export type BagDimensions = { height_cm: number; width_cm: number; depth_cm: number };
export type AirlineFrame = { code: string; name: string; height_cm: number; width_cm: number; depth_cm: number };

const FIT_CATEGORIES = new Set(['luggage', 'backpacks', 'totes']);

export function hasCabinFit(category: string): boolean {
  return FIT_CATEGORIES.has(category);
}

/** One place decides the cabin-fit verdict, with wheels and handle counted. */
export function fitVerdict(bag: BagDimensions, airline: AirlineFrame): {
  fits: boolean;
  overhang_cm: { height: number; width: number; depth: number };
  max_overhang_cm: number;
  verdict: string;
} {
  const height = overhang(bag.height_cm, airline.height_cm);
  const width = overhang(bag.width_cm, airline.width_cm);
  const depth = overhang(bag.depth_cm, airline.depth_cm);
  const max = Math.max(height, width, depth);
  const fits = max === 0;
  return {
    fits,
    overhang_cm: { height, width, depth },
    max_overhang_cm: max,
    verdict: fits
      ? `Fits the ${airline.name} cabin frame.`
      : `Over by ${trimNumber(max)} cm for the ${airline.name} cabin frame.`,
  };
}

function overhang(bagCm: number, limitCm: number): number {
  return Math.max(0, Math.round((bagCm - limitCm) * 10) / 10);
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** The one place the stock badge is decided. */
export function stockBadge(available: number): string {
  if (available <= 0) return 'Out of stock';
  if (available <= CONFIG.lowStockThreshold) return `Only ${available} left`;
  return 'In stock';
}

export function isLowStock(available: number): boolean {
  return available >= 0 && available <= CONFIG.lowStockThreshold;
}

/** Compare-at save percent: (compare_at − price) × 100 ÷ compare_at, half up. */
export function savePercent(price: number, compareAt: number | null): number | null {
  if (compareAt === null || compareAt === undefined) return null;
  return Math.round(((compareAt - price) * 100) / compareAt);
}
