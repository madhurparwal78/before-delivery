import { Pennies, addMargin, percentOf } from './money.js';

export const SIZES = [8, 12, 16, 31, 49, 56, 70] as const;
export type Size = (typeof SIZES)[number];

const BAG_UNITS: Record<Size, number> = { 8: 16, 12: 24, 16: 32, 31: 62, 49: 98, 56: 112, 70: 140 };
const LIFT_SIZES: Size[] = [16, 49];
const WHEELCHAIRS_PER_LIFT = 2;

export function isSize(value: unknown): value is Size {
  return typeof value === 'number' && (SIZES as readonly number[]).includes(value);
}

export function isMinibus(seats: Size): boolean {
  return seats === 8 || seats === 12 || seats === 16;
}

export function bagUnitsOf(seats: Size): number {
  return BAG_UNITS[seats];
}

export function wheelchairRoomOf(seats: Size): number {
  return LIFT_SIZES.includes(seats) ? WHEELCHAIRS_PER_LIFT : 0;
}

export type Party = { people: number; large: number; medium: number; hand: number; wheelchairs: number };

export function bagUnitsNeeded(party: Party): number {
  return party.large * 3 + party.medium * 2 + party.hand;
}

function largestFirst(sizes: Size[]): Size[] {
  return [...sizes].sort((a, b) => b - a);
}

function holds(plan: Size[], party: Party): boolean {
  const seats = plan.reduce((sum, size) => sum + size, 0);
  const bags = plan.reduce((sum, size) => sum + bagUnitsOf(size), 0);
  const room = plan.reduce((sum, size) => sum + wheelchairRoomOf(size), 0);
  return seats >= party.people && bags >= bagUnitsNeeded(party) && room >= party.wheelchairs;
}

/** True when the left plan beats the right one on the published ordering. */
function beats(left: Size[], right: Size[], party: Party): boolean {
  if (left.length !== right.length) return left.length < right.length;
  const leftEmpty = left.reduce((sum, size) => sum + size, 0) - party.people;
  const rightEmpty = right.reduce((sum, size) => sum + size, 0) - party.people;
  if (leftEmpty !== rightEmpty) return leftEmpty < rightEmpty;
  const a = largestFirst(left);
  const b = largestFirst(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

const MAX_VEHICLES = 10;

/** The fewest vehicles that seat everyone, hold every bag and have room for every wheelchair user. */
export function suggestPlan(party: Party): Size[] {
  let best: Size[] | null = null;
  const build = (startIndex: number, chosen: Size[]): void => {
    if (chosen.length > 0 && holds(chosen, party)) {
      if (!best || beats(chosen, best, party)) best = largestFirst(chosen);
      return;
    }
    if (chosen.length >= MAX_VEHICLES) return;
    if (best && chosen.length + 1 > best.length) return;
    for (let index = startIndex; index < SIZES.length; index += 1) {
      build(index, [...chosen, SIZES[index]]);
    }
  };
  build(0, []);
  return best ?? [SIZES[SIZES.length - 1]];
}

export type PlanRefusal = { message: string };

/** The published order of refusals for a typed plan. */
export function refusePlan(plan: number[], party: Party): PlanRefusal | null {
  for (const size of plan) {
    if (!isSize(size)) return { message: 'Choose sizes from 8, 12, 16, 31, 49, 56 and 70.' };
  }
  if (plan.length === 0) return { message: 'Choose sizes from 8, 12, 16, 31, 49, 56 and 70.' };
  const sizes = plan as Size[];
  const seats = sizes.reduce((sum, size) => sum + size, 0);
  if (seats < party.people) {
    const short = party.people - seats;
    return {
      message:
        short === 1
          ? 'This plan leaves 1 person without a seat.'
          : `This plan leaves ${short} people without a seat.`,
    };
  }
  const bags = sizes.reduce((sum, size) => sum + bagUnitsOf(size), 0);
  const needed = bagUnitsNeeded(party);
  if (bags < needed) {
    const short = needed - bags;
    return {
      message: short === 1 ? 'Bags need 1 more unit of space.' : `Bags need ${short} more units of space.`,
    };
  }
  const room = sizes.reduce((sum, size) => sum + wheelchairRoomOf(size), 0);
  if (room < party.wheelchairs) {
    return {
      message:
        party.wheelchairs === 1
          ? 'This plan has no lift for 1 wheelchair user.'
          : `This plan has no lift for ${party.wheelchairs} wheelchair users.`,
    };
  }
  return null;
}

export function largerThanNeeded(plan: Size[], suggested: Size[]): boolean {
  if (plan.length > suggested.length) return true;
  if (plan.length < suggested.length) return false;
  const planSeats = plan.reduce((sum, size) => sum + size, 0);
  const suggestedSeats = suggested.reduce((sum, size) => sum + size, 0);
  return planSeats > suggestedSeats;
}

export const MILES_PER_KM = 0.621371;

/** Kilometres as a decimal string to miles, half up to one decimal. */
export function kmToMiles(km: string): string {
  const [whole, part = ''] = km.split('.');
  const scaledKm = Number(whole) * 1000 + Number(part.padEnd(3, '0').slice(0, 3));
  const tenthsTimes = scaledKm * 621371;
  const tenths = Math.floor(tenthsTimes / 100000000 + 0.5);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export type VehicleMoney = {
  sellingPrice: Pennies;
  vat: Pennies;
  total: Pennies;
  deposit: Pennies;
};

export type DepositRates = {
  depositMinibus: Pennies;
  depositMinibusHigher: Pennies;
  depositCoach: Pennies;
  depositCoachHigher: Pennies;
};

const VAT_TENTHS = 200;
const MINIBUS_HIGHER_OVER = 75000;
const COACH_HIGHER_OVER = 100000;

/** Selling price, VAT and deposit for one vehicle. Decided here and nowhere else. */
export function vehicleMoney(
  boughtPrice: Pennies,
  marginTenths: number,
  seats: Size,
  rates: DepositRates,
): VehicleMoney {
  const sellingPrice = addMargin(boughtPrice, marginTenths);
  const vat = seats === 8 ? percentOf(sellingPrice, VAT_TENTHS) : 0;
  const total = sellingPrice + vat;
  const deposit = depositFor(total, seats, rates);
  return { sellingPrice, vat, total, deposit };
}

export function depositFor(total: Pennies, seats: Size, rates: DepositRates): Pennies {
  if (isMinibus(seats)) {
    return total > MINIBUS_HIGHER_OVER ? rates.depositMinibusHigher : rates.depositMinibus;
  }
  return total > COACH_HIGHER_OVER ? rates.depositCoachHigher : rates.depositCoach;
}
