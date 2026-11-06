// Wall-clock time in an IANA zone, decided only here.
import { ZONE_IDS, ZONE_TRANSITIONS } from './zone-data.js';

const MINUTE = 60_000;

export interface Wall {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

export function isZone(name: string): boolean {
  return (ZONE_IDS as readonly string[]).includes(name);
}

// Offset in minutes east of UTC at the instant.
export function offsetAt(zone: string, instant: number): number {
  const trans = ZONE_TRANSITIONS[zone];
  if (!trans) return 0;
  const m = Math.floor(instant / MINUTE);
  let off = trans[0]![1]!;
  for (let i = trans.length - 1; i >= 0; i--) {
    if (trans[i]![0]! <= m) {
      off = trans[i]![1]!;
      break;
    }
  }
  return off;
}

export function utcToWall(zone: string, instant: number): Wall {
  const d = new Date(instant + offsetAt(zone, instant) * MINUTE);
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: weekdays[d.getUTCDay()]!,
  };
}

export function wallKey(w: Wall): string {
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Every instant at which this local wall time occurs (0, 1 or 2).
function candidatesForWall(zone: string, year: number, month: number, day: number, hour: number, minute: number): number[] {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offs = new Set<number>();
  for (const probe of [naive - 36 * 60 * MINUTE, naive, naive + 36 * 60 * MINUTE]) {
    const c = naive - offsetAt(zone, probe) * MINUTE;
    offs.add(offsetAt(zone, c));
  }
  const out: number[] = [];
  for (const off of offs) {
    const c = naive - off * MINUTE;
    if (offsetAt(zone, c) !== off) continue;
    const w = utcToWall(zone, c);
    if (w.year === year && w.month === month && w.day === day && w.hour === hour && w.minute === minute) {
      out.push(c);
    }
  }
  out.sort((a, b) => a - b);
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

// The instant a night's reminder is due: the first valid local minute at or
// after the hour's start time on that night's local date.
export function dueInstant(zone: string, night: NightId, startHHMM: string): number {
  const [year, month, day] = night.split('-').map(Number) as [number, number, number];
  const [hour, minute] = startHHMM.split(':').map(Number) as [number, number];
  let h = hour;
  let m = minute;
  for (let step = 0; step <= 180; step++) {
    const found = candidatesForWall(zone, year, month, day, h, m);
    if (found.length > 0) return found[0]!;
    m += 1;
    if (m === 60) {
      m = 0;
      h = (h + 1) % 24;
    }
  }
  return candidatesForWall(zone, year, month, day, hour, minute)[0] ?? Date.UTC(year, month - 1, day, hour, minute);
}

// The local wall time at which that due instant actually happens.
export function dueLocalTime(zone: string, instant: number): string {
  const w = utcToWall(zone, instant);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

export type NightId = string; // YYYY-MM-DD, the local date the hour starts

export function nightOf(zone: string, instant: number): NightId {
  const w = utcToWall(zone, instant);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function nextNight(night: NightId): NightId {
  const [y, m, d] = night.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function nightBefore(night: NightId): NightId {
  const [y, m, d] = night.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function localWeekdayOfNight(night: NightId): string {
  const [y, m, d] = night.split('-').map(Number) as [number, number, number];
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

export function monthName(n: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'][n - 1]!;
}
