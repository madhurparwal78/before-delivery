import { BerthQuota, BerthType, ClassCode } from './types.js';

// Berth and bay layout, decided in exactly one place. 72 berths in nine bays of eight.

export const BAYS = 9;
export const BERTHS_PER_COACH = 72;

export function bayOf(berth: number): number {
  return Math.ceil(berth / 8);
}

export function berthType(berth: number): BerthType {
  const k = bayOf(berth);
  const pos = ((berth - 1) % 8) + 1; // 1..8 within the bay
  if (pos === 1 || pos === 4) return 'LB';
  if (pos === 2 || pos === 5) return 'MB';
  if (pos === 3 || pos === 6) return 'UB';
  if (pos === 7) return 'SL';
  return 'SU';
}

export function berthPosInBay(berth: number): number {
  return ((berth - 1) % 8) + 1;
}

export const SS_BERTHS = new Set([1, 4, 9, 12, 17, 20]);
export const LD_BERTHS = new Set([41, 42, 43, 44, 45, 46]);
export const TQ_BERTHS = new Set(Array.from({ length: 12 }, (_, i) => 61 + i));
/** Side lowers that carry two RAC places each. */
export const RAC_BERTHS = new Set([7, 15, 23, 31, 39, 47]);

export function berthQuota(berth: number): BerthQuota {
  if (RAC_BERTHS.has(berth)) return 'RAC';
  if (SS_BERTHS.has(berth)) return 'SS';
  if (LD_BERTHS.has(berth)) return 'LD';
  if (TQ_BERTHS.has(berth)) return 'TQ';
  return 'GN';
}

/** "Lower berth" means lower or side lower. */
export function isLower(berth: number): boolean {
  const t = berthType(berth);
  return t === 'LB' || t === 'SL';
}

export function coachCount(cls: ClassCode, coaches: { code: string; cls: ClassCode }[]): number {
  return coaches.filter((c) => c.cls === cls).length;
}

/** General pool berths per coach: 42. */
export const GN_POOL_PER_COACH = 42;

/** Waiting-list cap: 30% of the General pool on SL, 60% on 3A, floored. Tatkal pool uses the same share. */
export function wlCap(cls: ClassCode, poolBerths: number): number {
  const share = cls === 'SL' ? 0.3 : 0.6;
  return Math.floor(poolBerths * share);
}

/** Berth order within a bay for keyboard navigation. */
export const BAY_ORDER: BerthType[] = ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'];
