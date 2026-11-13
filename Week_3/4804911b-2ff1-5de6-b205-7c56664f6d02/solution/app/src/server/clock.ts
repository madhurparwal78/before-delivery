import { config } from "./config.js";

// Every date decision is made on Asia/Kolkata calendar days, computed from UTC arithmetic so the process zone never matters.
const KOLKATA_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;

let frozen: number | null = null;

const nowMs = (): number => frozen ?? Date.now();
export const nowIso = (): string => new Date(nowMs()).toISOString();

export function setClock(ms: number | null): void {
  if (config.testClock) frozen = ms;
}

export const kolkataDay = (ms: number): string => new Date(ms + KOLKATA_OFFSET_MS).toISOString().slice(0, 10);
export const today = (): string => kolkataDay(nowMs());

function dayToMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}
export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return new Date(dayToMs(day)).toISOString().slice(0, 10) === day;
}
export const addDays = (day: string, n: number): string => new Date(dayToMs(day) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number => Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS);
