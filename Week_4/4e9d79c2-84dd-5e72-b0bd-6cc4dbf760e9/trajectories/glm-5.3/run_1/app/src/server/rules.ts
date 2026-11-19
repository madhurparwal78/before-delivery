import type { Config } from "./config.js";
import type { PgClient } from "./db.js";
import { makeReference, foldEmail, isoInstant } from "./domain.js";
import { ukDateString, ukFields, ukToInstant, isRepeatedTime } from "./uktime.js";
import { cryptoRandom } from "./auth.js";
import { percentOf, fractionOf, type Pennies } from "./money.js";

export interface Party {
  people: number;
  large: number;
  medium: number;
  hand: number;
  wheelchairs: number;
}

export const SIZES = [8, 12, 16, 31, 49, 56, 70] as const;
export type Size = (typeof SIZES)[number];

const SEAT_BY_SIZE: Record<number, number> = { 8: 8, 12: 12, 16: 16, 31: 31, 49: 49, 56: 56, 70: 70 };
const BAG_UNITS: Record<number, number> = { 8: 16, 12: 24, 16: 32, 31: 62, 49: 98, 56: 112, 70: 140 };
const LIFT_SIZES = new Set([16, 49]);

export function seatsFor(size: number): number {
  return SEAT_BY_SIZE[size] ?? 0;
}

export function bagUnits(size: number): number {
  return BAG_UNITS[size] ?? 0;
}

export function hasLift(size: number): boolean {
  return LIFT_SIZES.has(size);
}

export function partyBagUnits(p: Party): number {
  return p.large * 3 + p.medium * 2 + p.hand * 1;
}

/** Fewest-vehicle plan per DP-14 ordering: fewest vehicles, then fewest empty seats, then largest-first list. */
export function suggestPlan(p: Party): number[] {
  const all = [...SIZES];
  const fits = (list: number[]): boolean => {
    const seatsSum = list.reduce((s, x) => s + seatsFor(x), 0);
    if (seatsSum < p.people) return false;
    const bagsSum = list.reduce((s, x) => s + bagUnits(x), 0);
    if (bagsSum < partyBagUnits(p)) return false;
    const lifts = list.filter((x) => hasLift(x)).length * 2;
    return lifts >= p.wheelchairs;
  };
  const results: number[][] = [];
  for (const a of all) for (const b of all) for (const c of all) if (fits([a, b, c])) results.push([a, b, c]);
  for (const a of all) for (const b of all) if (fits([a, b])) results.push([a, b]);
  for (const a of all) if (fits([a])) results.push([a]);
  results.sort((x, y) => {
    if (x.length !== y.length) return x.length - y.length;
    const ex = x.reduce((s, v) => s + seatsFor(v), 0) - p.people;
    const ey = y.reduce((s, v) => s + seatsFor(v), 0) - p.people;
    if (ex !== ey) return ex - ey;
    const a = [...x].sort((m, n) => n - m);
    const b = [...y].sort((m, n) => n - m);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
  });
  if (results.length) return [...results[0]].sort((m, n) => n - m);
  return [70, 70, 70, 70];
}

export interface PlanCheck {
  ok: boolean;
  seatsShort?: number;
  bagsShort?: number;
  wheelchairsShort?: number;
  badSize?: boolean;
}

export function checkPlan(sizes: number[], party: Party): PlanCheck {
  for (const s of sizes) if (!(SIZES as readonly number[]).includes(s)) return { ok: false, badSize: true };
  const seats = sizes.reduce((s, x) => s + seatsFor(x), 0);
  if (seats < party.people) return { ok: false, seatsShort: party.people - seats };
  const bags = sizes.reduce((s, x) => s + bagUnits(x), 0);
  const bagNeed = partyBagUnits(party);
  if (bags < bagNeed) return { ok: false, bagsShort: bagNeed - bags };
  const lifts = sizes.filter((x) => hasLift(x)).length * 2;
  if (lifts < party.wheelchairs) return { ok: false, wheelchairsShort: party.wheelchairs - lifts };
  return { ok: true };
}

export function largerThanNeeded(sizes: number[], suggested: number[]): boolean {
  if (sizes.length > suggested.length) return true;
  if (sizes.length === suggested.length) {
    const s1 = sizes.reduce((a, b) => a + seatsFor(b), 0);
    const s2 = suggested.reduce((a, b) => a + seatsFor(b), 0);
    return s1 > s2;
  }
  return false;
}

export function vehicleClassFor(sizes: number[]): "coach" | "minibus" {
  return sizes.some((s) => s >= 31) ? "coach" : "minibus";
}

/** Quote money per DP-24. */
export interface QuoteVehicleMoney {
  seats: number;
  bought: Pennies;
  margin: string;
  selling: Pennies;
  vat: Pennies;
  total: Pennies;
  deposit: Pennies;
}

export interface DepositLimits {
  minibus: number;
  minibusHigher: number;
  coach: number;
  coachHigher: number;
  minibusHigherAt: number;
  coachHigherAt: number;
}

export function quoteVehicleMoney(bought: Pennies, marginPercent: string, seats: number, limits: DepositLimits): QuoteVehicleMoney {
  const margin = Number(marginPercent);
  const selling = percentOf(bought, margin);
  const vatRate = seats >= 12 ? 0 : 20;
  const vat = fractionOf(selling, vatRate);
  const total = selling + vat;
  const overLimit = seats < 12 ? total > limits.minibusHigherAt : total > limits.coachHigherAt;
  const deposit = seats < 12 ? (overLimit ? limits.minibusHigher : limits.minibus) : overLimit ? limits.coachHigher : limits.coach;
  return { seats, bought, margin: String(margin), selling, vat, total, deposit };
}

export interface RateTable {
  id: string;
  effectiveFrom: string;
  defaultMarginPercent: string;
  waitingRatePennies: number;
  secondDriverPennies: number;
  depositMinibus: number;
  depositMinibusHigher: number;
  depositCoach: number;
  depositCoachHigher: number;
}

export function rateInForce(tables: RateTable[], on: string): RateTable {
  const sorted = [...tables].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  for (const t of sorted) if (t.effectiveFrom <= on) return t;
  return sorted[sorted.length - 1] ?? {
    id: "",
    effectiveFrom: "2000-01-01",
    defaultMarginPercent: "15",
    waitingRatePennies: 2000,
    secondDriverPennies: 15000,
    depositMinibus: 5000,
    depositMinibusHigher: 10000,
    depositCoach: 10000,
    depositCoachHigher: 15000,
  };
}

/** Waiting charge: 15 free minutes then the hour rate pro rata per minute, half up per stop. */
export function waitingPennies(minutes: number, hourlyRatePennies: number): Pennies {
  const free = 15;
  if (minutes <= free) return 0;
  const billable = minutes - free;
  return Math.floor((billable * hourlyRatePennies * 10 + 300) / 600);
}

/** Comfort-stop charge: the excess over 15 minutes, same per-minute rate. */
export function comfortCharge(minutes: number, hourlyRatePennies: number): Pennies {
  return waitingPennies(minutes, hourlyRatePennies);
}

export type { Config, PgClient, makeReference, foldEmail, isoInstant, ukDateString, ukFields, ukToInstant, isRepeatedTime, cryptoRandom, Pennies };
