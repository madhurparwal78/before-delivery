import { createHash, createHmac } from 'node:crypto';
import type { AppConfig } from './config.js';

/**
 * The server clock: real time plus one stored offset. Every time rule in the
 * product follows nowMs(); the browser never decides time-dependent state.
 */
export class Clock {
  offsetMs = 0n;

  nowMs(): number {
    return Date.now() + Number(this.offsetMs);
  }

  nowIso(): string {
    return new Date(this.nowMs()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  advance(seconds: number): void {
    this.offsetMs += BigInt(seconds) * 1000n;
  }
}

const DAY_MS = 86_400_000;

/** Server-side display formatting for the workspace time zone. */
export function formatWorkspaceTime(isoOrMs: string | number, timeZone: string): string {
  const d = typeof isoOrMs === 'string' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const abbr = timeZoneAbbr(d, timeZone);
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${abbr}`;
}

function timeZoneAbbr(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(d);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  if (/^(GMT|UTC)/.test(name)) return 'UTC';
  return name.replace(/^GMT[+-]?/, (m) => m).replace(/ /g, '');
}
