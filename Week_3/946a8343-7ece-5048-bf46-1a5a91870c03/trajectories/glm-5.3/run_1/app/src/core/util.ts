import { createHash, createHmac, randomUUID } from 'node:crypto';

export const STATUS_UNAVAILABLE = 'File storage is unavailable. Uploads, artifacts and exports are paused.';
export const STATUS_UNAVAILABLE_COMMIT = 'File storage is unavailable. Nothing was committed. Try again in a moment.';
export const EXPORT_FAILED_STORAGE = 'Export failed: file storage is unavailable.';
export const ARTIFACT_UPLOAD_FAILED = 'Artifact upload failed: file storage is unavailable.';
export const CACHE_SKIPPED = 'Cache skipped: file storage is unavailable.';
export const EXPORT_RETRY_COPY = 'Retry export';

export interface Clock {
  readonly nowMs: () => number;
}

export class ServerClock implements Clock {
  private now = 0;
  private readonly grading: boolean;

  constructor(grading: boolean, wallStart = () => Date.now()) {
    this.grading = grading;
    if (!grading) this.now = wallStart();
  }

  nowMs(): number {
    if (this.grading) return this.now;
    return Date.now();
  }

  set(ms: number): void {
    this.now = ms;
  }

  advance(ms: number): void {
    this.now += ms;
  }
}

export function short(sha: string): string {
  return sha.slice(0, 7);
}

export function lowerHex64(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

export function isSha(s: unknown): s is string {
  return typeof s === 'string' && lowerHex64(s);
}

export function parseDurationMs(v: string): number | 'never' | null {
  const s = String(v).trim();
  if (s === 'never') return 'never';
  if (!/^\d+(ms|s|m|h)$/.test(s)) return null;
  if (s.endsWith('ms')) return parseInt(s, 10);
  if (s.endsWith('s')) return parseInt(s, 10) * 1000;
  if (s.endsWith('m')) return parseInt(s, 10) * 60_000;
  return parseInt(s, 10) * 3_600_000;
}

export function durationSecondsSuffix(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (s === 0) return `${m}s`;
  return `${m}m ${s}s`;
}

export function randomHex(): string {
  return createHash('sha256').update(randomUUID()).digest('hex');
}

export function hmacSign(secret: string, body: string, timestamp: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function ianaZoneOk(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function zoneTime(ms: number, zone: string): { date: string; secondsInDay: number; offsetMs: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string): number => {
    const p = parts.find((x) => x.type === t);
    return p ? parseInt(p.value, 10) : 0;
  };
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour') % 24;
  const minute = get('minute');
  const second = get('second');
  const secondsInDay = hour * 3600 + minute * 60 + second;
  const utc = Date.UTC(year, month - 1, day);
  const offsetMs = utc + secondsInDay * 1000 - ms;
  return { date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, secondsInDay, offsetMs };
}

export function zoneDate(ms: number, zone: string): string {
  return zoneTime(ms, zone).date;
}

export function zoneOffsetSeconds(ms: number, zone: string): number {
  return Math.round(zoneTime(ms, zone).offsetMs / 1000);
}

export function dayFloor(ms: number, zone: string): number {
  const t = zoneTime(ms, zone);
  const utc = Date.parse(`${t.date}T00:00:00Z`);
  return utc - t.offsetMs;
}

export function parseDateOnly(s: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== parseInt(s.slice(0, 4), 10)) return null;
  if (dt.getUTCMonth() !== parseInt(s.slice(5, 7), 10) - 1) return null;
  if (dt.getUTCDate() !== parseInt(s.slice(8), 10)) return null;
  return t;
}

export function iso(ms: number): string {
  return new Date(ms).toISOString().replace('Z', '000Z');
}

export function isoFull(ms: number): string {
  return new Date(ms).toISOString();
}

export function base36(n: number): string {
  return n.toString(36);
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, h) => a - h);
  if (s.length % 2 === 1) return s[(s.length - 1) / 2];
  return (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function eventOrderRandom(): number {
  return Math.random();
}
