import { digitsToInteger } from "./digits";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export type IsoDate = string;

function toUtc(date: IsoDate): number {
  const found = ISO_DATE.exec(date);
  return Date.UTC(digitsToInteger(found?.[1] ?? "0"), digitsToInteger(found?.[2] ?? "1") - 1, digitsToInteger(found?.[3] ?? "1"));
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return new Date(toUtc(value)).toISOString().slice(0, 10) === value;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtc(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return (toUtc(to) - toUtc(from)) / MS_PER_DAY;
}

/** 0 is Sunday. */
export function weekday(date: IsoDate): number {
  return new Date(toUtc(date)).getUTCDay();
}

/** The nights of a stay: arrival up to but not including departure. */
export function nightsBetween(arrival: IsoDate, departure: IsoDate): IsoDate[] {
  return Array.from({ length: daysBetween(arrival, departure) }, (_, index) => addDays(arrival, index));
}
