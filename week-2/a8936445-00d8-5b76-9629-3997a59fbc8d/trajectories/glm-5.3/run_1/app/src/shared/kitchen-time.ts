/**
 * Kitchen wall-clock time. One time zone governs every date, minute and edge in the product;
 * the browser's and the server's own zones never matter. All maths is on wall-clock minutes
 * (0..1440) and UTC instants (epoch ms), resolved through Intl.
 */

export type KitchenDate = string; // YYYY-MM-DD
export type LocalTime = string; // HH:MM or 24:00

export interface KitchenParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface DayMinuteRange {
  start: number; // inclusive, wall minutes 0..1440
  end: number; // exclusive
}

export type Instant = number; // epoch ms

const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, "0");

export const toKitchenDate = (y: number, m: number, d: number): KitchenDate =>
  `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

export const toLocalTime = (hour: number, minute: number): LocalTime => `${pad(hour)}:${pad(minute)}`;

export class KitchenClock {
  readonly zone: string;
  private formatter: Intl.DateTimeFormat;

  constructor(zone: string) {
    this.zone = zone;
    this.formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  parts(epochMs: number): KitchenParts {
    // Note: with hour12:false, hour can come back as "24" for midnight in some environments.
    const map = new Map<string, number>();
    for (const p of this.formatter.formatToParts(epochMs)) {
      if (p.type !== "literal") map.set(p.type, Number(p.value));
    }
    let hour = map.get("hour") ?? 0;
    if (hour === 24) hour = 0;
    return {
      year: map.get("year") ?? 0,
      month: map.get("month") ?? 0,
      day: map.get("day") ?? 0,
      hour,
      minute: map.get("minute") ?? 0,
      second: map.get("second") ?? 0
    };
  }

  /** UTC offset in minutes east of UTC at the given instant. */
  offsetMinutes(epochMs: number): number {
    const p = this.parts(epochMs);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - epochMs) / 60000);
  }

  dateOf(epochMs: number): KitchenDate {
    const p = this.parts(epochMs);
    return toKitchenDate(p.year, p.month, p.day);
  }

  /** Kitchen instant as ISO 8601 with the kitchen's offset, e.g. 2026-11-03T05:00:00-06:00. */
  isoOf(epochMs: number): string {
    const p = this.parts(epochMs);
    const off = this.offsetMinutes(epochMs);
    const sign = off < 0 ? "-" : "+";
    const abs = Math.abs(off);
    return `${toKitchenDate(p.year, p.month, p.day)}T${toLocalTime(p.hour, p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  today(): KitchenDate {
    return this.dateOf(Date.now());
  }

  /** Current wall minute of the kitchen day (0..1439). */
  minuteOfDayNow(): number {
    const p = this.parts(Date.now());
    return p.hour * 60 + p.minute;
  }

  /**
   * Resolve a kitchen wall time on a kitchen date to the earliest matching instant.
   * Returns null when that wall time does not exist (spring-forward gap),
   * and the first (daylight-time) instant when it occurs twice (fall-back).
   */
  localToInstant(date: KitchenDate, time: LocalTime): Instant | null {
    const { hour, minute } = parseLocalTime(time);
    const [y, m, d] = parseKitchenDate(date);
    if (hour === 24 && minute === 0) {
      return this.localToInstant(addDays(date, 1), "00:00");
    }
    const approx = Date.UTC(y, m - 1, d, hour, minute);
    const midday = Date.UTC(y, m - 1, d, 12, 0);
    const candidates = new Set<number>([
      this.offsetMinutes(midday),
      this.offsetMinutes(midday - 6 * 3600_000),
      this.offsetMinutes(midday + 6 * 3600_000)
    ]);
    const matches: number[] = [];
    for (const off of candidates) {
      const instant = approx - off * 60_000;
      const p = this.parts(instant);
      if (p.year === y && p.month === m && p.day === d && p.hour === hour && p.minute === minute) {
        matches.push(instant);
      }
    }
    if (matches.length === 0) return null;
    return Math.min(...matches);
  }

  /** Wall minute of a local time ("24:00" is 1440). */
  minuteOfDay(time: LocalTime): number {
    const { hour, minute } = parseLocalTime(time);
    return hour * 60 + minute;
  }

  localTimeOfMinute(minute: number): LocalTime {
    return toLocalTime(Math.floor(minute / 60), minute % 60);
  }

  /**
   * The wall-clock minute range that does not exist (spring) or occurs twice (fall) on a date.
   * Only run on days whose start and end offsets differ.
   */
  clockChange(date: KitchenDate): { skipped: DayMinuteRange | null; repeated: DayMinuteRange | null } {
    const start = this.localToInstant(date, "00:00");
    const end = this.localToInstant(addDays(date, 1), "00:00");
    if (start === null || end === null) return { skipped: null, repeated: null };
    const o1 = this.offsetMinutes(start);
    const o2 = this.offsetMinutes(end);
    if (o1 === o2) return { skipped: null, repeated: null };
    const [yy, mo, dd] = parseKitchenDate(date);
    const midday = Date.UTC(yy, mo - 1, dd, 12, 0);
    const offs = Array.from(
      new Set<number>([
        this.offsetMinutes(midday - 6 * 3600_000),
        this.offsetMinutes(midday + 6 * 3600_000)
      ])
    );
    let skippedStart = -1;
    let skippedEnd = -1;
    let repeatedStart = -1;
    let repeatedEnd = -1;
    for (let m = 0; m < 1440; m++) {
      const hh = Math.floor(m / 60);
      const mm = m % 60;
      const approx = Date.UTC(yy, mo - 1, dd, hh, mm);
      let matches = 0;
      for (const off of offs) {
        const inst = approx - off * 60_000;
        const p = this.parts(inst);
        if (p.hour === hh && p.minute === mm && this.dateOf(inst) === date) matches++;
      }
      if (matches === 0) {
        if (skippedStart < 0) skippedStart = m;
        skippedEnd = m + 1;
      } else if (matches >= 2) {
        if (repeatedStart < 0) repeatedStart = m;
        repeatedEnd = m + 1;
      }
    }
    return {
      skipped: skippedStart >= 0 ? { start: skippedStart, end: skippedEnd } : null,
      repeated: repeatedStart >= 0 ? { start: repeatedStart, end: repeatedEnd } : null
    };
  }

  monthOf(date: KitchenDate): string {
    return date.slice(0, 7);
  }

  /** First instant of a kitchen month (local midnight of its first day). */
  monthStartInstant(period: string): Instant | null {
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    if (!m) return null;
    return this.localToInstant(`${m[1]}-${m[2]}-01`, "00:00");
  }

  /** Exclusive end instant of a kitchen month (local midnight of the next month's first day). */
  monthEndInstant(period: string): Instant | null {
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const ny = mo === 12 ? y + 1 : y;
    const nm = mo === 12 ? 1 : mo + 1;
    return this.localToInstant(toKitchenDate(ny, nm, 1), "00:00");
  }

  addDaysLocal(date: KitchenDate, days: number): KitchenDate {
    return addDays(date, days);
  }

  /** Calendar days between two kitchen dates (to - from). */
  daysBetween(from: KitchenDate, to: KitchenDate): number {
    const [y1, m1, d1] = parseKitchenDate(from);
    const [y2, m2, d2] = parseKitchenDate(to);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  }

  formatHuman(epochMs: number): string {
    const p = this.parts(epochMs);
    return `${toKitchenDate(p.year, p.month, p.day)} ${toLocalTime(p.hour, p.minute)}`;
  }
}

export function parseKitchenDate(date: KitchenDate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`bad kitchen date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function parseLocalTime(time: LocalTime): { hour: number; minute: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) throw new Error(`bad local time: ${time}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function addDays(date: KitchenDate, days: number): KitchenDate {
  const [y, m, d] = parseKitchenDate(date);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return toKitchenDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function isValidKitchenDate(date: string): date is KitchenDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = parseKitchenDate(date);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 1;
}

export function isValidLocalTime(time: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const { hour, minute } = parseLocalTime(time);
  if (minute % 15 !== 0) return false;
  if (hour === 24 && minute === 0) return true;
  return hour >= 0 && hour <= 23;
}

/** Wall-clock length of a block in minutes ("24:00" end counts as 1440). */
export function wallMinutes(start: LocalTime, end: LocalTime): number {
  const s = parseLocalTime(start);
  const e = parseLocalTime(end);
  return e.hour * 60 + e.minute - (s.hour * 60 + s.minute);
}
