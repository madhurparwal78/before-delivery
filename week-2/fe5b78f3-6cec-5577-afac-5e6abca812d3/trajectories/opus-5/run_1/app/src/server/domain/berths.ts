export type TravelClass = 'SL' | '3A';
export type Quota = 'GN' | 'TQ' | 'LD' | 'SS';
export type BerthPool = Quota | 'RAC';
export type BerthType = 'LB' | 'MB' | 'UB' | 'SL' | 'SU';
export type BerthPreference = BerthType | 'NONE';

export const BERTHS_PER_COACH = 72;
export const BAYS_PER_COACH = 9;
export const BERTHS_PER_BAY = 8;

const SENIOR_BERTHS: readonly number[] = [1, 4, 9, 12, 17, 20];
const LADIES_BERTHS: readonly number[] = [41, 42, 43, 44, 45, 46];
const RAC_BERTHS: readonly number[] = [7, 15, 23, 31, 39, 47];
const TATKAL_FIRST = 61;

export const RAC_PLACES_PER_BERTH = 2;

export interface BerthSpec {
  readonly berth: number;
  readonly bay: number;
  readonly type: BerthType;
  readonly pool: BerthPool;
}

/** Position of a berth within its bay. In bay k: 8k-7/8k-4 lower, 8k-6/8k-3 middle, 8k-5/8k-2 upper, 8k-1 side lower, 8k side upper. */
function berthType(berth: number): BerthType {
  const withinBay = ((berth - 1) % BERTHS_PER_BAY) + 1;
  switch (withinBay) {
    case 1:
    case 4:
      return 'LB';
    case 2:
    case 5:
      return 'MB';
    case 3:
    case 6:
      return 'UB';
    case 7:
      return 'SL';
    default:
      return 'SU';
  }
}

function berthPool(berth: number): BerthPool {
  if (RAC_BERTHS.includes(berth)) return 'RAC';
  if (SENIOR_BERTHS.includes(berth)) return 'SS';
  if (LADIES_BERTHS.includes(berth)) return 'LD';
  if (berth >= TATKAL_FIRST) return 'TQ';
  return 'GN';
}

export const COACH_BERTHS: readonly BerthSpec[] = Array.from(
  { length: BERTHS_PER_COACH },
  (_unused, index): BerthSpec => {
    const berth = index + 1;
    return {
      berth,
      bay: Math.ceil(berth / BERTHS_PER_BAY),
      type: berthType(berth),
      pool: berthPool(berth),
    };
  },
);

export function berthSpec(berth: number): BerthSpec {
  return COACH_BERTHS[berth - 1];
}

export function poolBerths(pool: BerthPool): readonly BerthSpec[] {
  return COACH_BERTHS.filter((spec) => spec.pool === pool);
}

/** "Lower berth" means lower or side lower. */
export function isLowerBerth(type: BerthType): boolean {
  return type === 'LB' || type === 'SL';
}

export const POSITION_WORD: Readonly<Record<BerthType, string>> = {
  LB: 'lower',
  MB: 'middle',
  UB: 'upper',
  SL: 'side lower',
  SU: 'side upper',
};

export const QUOTA_LABEL: Readonly<Record<Quota, string>> = {
  GN: 'General',
  TQ: 'Tatkal',
  LD: 'Ladies',
  SS: 'Senior',
};

export function isTravelClass(value: unknown): value is TravelClass {
  return value === 'SL' || value === '3A';
}

export function isQuota(value: unknown): value is Quota {
  return value === 'GN' || value === 'TQ' || value === 'LD' || value === 'SS';
}

export function isBerthPreference(value: unknown): value is BerthPreference {
  return value === 'LB' || value === 'MB' || value === 'UB' || value === 'SL'
    || value === 'SU' || value === 'NONE';
}
