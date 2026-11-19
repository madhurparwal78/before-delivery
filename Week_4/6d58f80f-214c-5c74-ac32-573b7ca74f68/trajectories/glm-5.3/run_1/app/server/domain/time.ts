import { config } from '../config/runtime.js';

const PHOENIX_OFFSET_MS = -7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let clockOffsetMs = 0;

function toPhoenixParts(ms: number): { y: number; m: number; d: number } {
  const shifted = new Date(ms + PHOENIX_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

export function todayPhoenix(nowMs?: number): string {
  const p = toPhoenixParts(nowMs ?? now());
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function toInstant(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

export function now(): number {
  return Date.now() + clockOffsetMs;
}

export function phoenixMidnightAfter(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) - PHOENIX_OFFSET_MS;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d) + days * DAY_MS;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function setClock(instant: string): void {
  const ms = Date.parse(instant);
  clockOffsetMs = ms - Date.now();
}

export function clockBody(): { now: string; today: string; zone: 'America/Phoenix' } {
  return { now: toInstant(now()), today: todayPhoenix(), zone: 'America/Phoenix' };
}

export function formatPhoenixDateTime(instant: string): string {
  const ms = Date.parse(instant) + PHOENIX_OFFSET_MS;
  const dt = new Date(ms);
  const date = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  const time = `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

export const clockControlEnabled = () => config.clockControl;
