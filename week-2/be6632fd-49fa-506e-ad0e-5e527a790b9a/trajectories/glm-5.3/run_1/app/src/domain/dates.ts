import { DateTimeFormatter, ZonedDateTime, ZoneId, Instant, LocalDate, LocalDateTime, ZoneOffset, IsoFields } from '@js-joda/core';
import '@js-joda/timezone';

const zoneCache = new Map<string, ZoneId>();
export function zoneOf(id: string): ZoneId {
  let z = zoneCache.get(id);
  if (!z) { z = ZoneId.of(id); zoneCache.set(id, z); }
  return z;
}

export const CPH = 'Europe/Copenhagen';

export function zonedAt(instant: Date, timeZone: string): ZonedDateTime {
  return Instant.ofEpochMilli(instant.getTime()).atZone(zoneOf(timeZone));
}

export function formatInZone(instant: Date, timeZone: string, pattern: string): string {
  return DateTimeFormatter.ofPattern(pattern).format(zonedAt(instant, timeZone));
}

export function cphDateOf(instant: Date): string {
  return formatInZone(instant, CPH, 'yyyy-MM-dd');
}

export function cphToday(now = new Date()): string {
  return cphDateOf(now);
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayName(dateStr: string): string {
  return DOW[LocalDate.parse(dateStr).dayOfWeek().value() - 1];
}

// The single place that turns a Copenhagen date into the printed date format.
export function dateWords(dateStr: string): string {
  const d = LocalDate.parse(dateStr);
  return `${DOW[d.dayOfWeek().value() - 1]} ${d.dayOfMonth()} ${MON[d.monthValue() - 1]} ${d.year()}`;
}

// The market-time format: Thu 18 Mar 2027, 10:00 Copenhagen time.
export function marketTimeWords(instant: Date, timeZone: string, city: string): string {
  const zdt = zonedAt(instant, timeZone);
  return `${DOW[zdt.dayOfWeek().value() - 1]} ${zdt.dayOfMonth()} ${MON[zdt.monthValue() - 1]} ${zdt.year()}, ${pad2(zdt.hour())}:${pad2(zdt.minute())} ${city} time`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseLocalDateTime(s: string): LocalDateTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  try {
    return LocalDateTime.of(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : 0);
  } catch { return null; }
}

export function parseDate(s: string): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  try { return LocalDate.of(Number(m[1]), Number(m[2]), Number(m[3])); } catch { return null; }
}

export function parseInstant(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(s);
  if (!m) return null;
  try {
    return new Date(LocalDateTime.of(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
      .toInstant(ZoneOffset.UTC).toEpochMilli());
  } catch { return null; }
}

// A local date-time answers with seconds only when they are not zero.
export function localDateTimeString(ldt: LocalDateTime): string {
  const base = `${ldt.year()}-${pad2(ldt.monthValue())}-${pad2(ldt.dayOfMonth())}T${pad2(ldt.hour())}:${pad2(ldt.minute())}`;
  return ldt.second() === 0 ? base : `${base}:${pad2(ldt.second())}`;
}

export function toInstantString(d: Date): string {
  return formatInZone(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

export class GapTimeError extends Error {
  constructor(public readonly date: string) { super('gap_time'); }
}

// A repeated autumn time means its first occurrence; a spring-forward gap time throws.
function resolveZoneOffset(zone: ZoneId, ldt: LocalDateTime): ZoneOffset {
  const valid = zone.rules().validOffsets(ldt);
  if (valid.length === 0) throw new GapTimeError(ldt.toLocalDate().toString());
  return valid[0];
}

export function localToInstant(ldt: LocalDateTime, timeZone: string): Date {
  const off = resolveZoneOffset(zoneOf(timeZone), ldt);
  return new Date(ldt.atOffset(off).toInstant().toEpochMilli());
}

export function isGapAt(zone: ZoneId, ldt: LocalDateTime): boolean {
  return zone.rules().validOffsets(ldt).length === 0;
}

export function cphLocal(ldt: LocalDateTime): Date {
  return localToInstant(ldt, CPH);
}

export interface MarketInstant { market: string; goLiveAt: Date; }

export interface GoLiveInput {
  type: 'simultaneous' | 'rolling';
  goLiveAt?: string | null;
  copenhagenGoLive?: string | null;
  localGoLive?: string | null;
}

// The single place that resolves a drop's go-live instants.
// Simultaneous: one UTC instant (goLiveAt) or a Copenhagen local time
// (copenhagenGoLive; gap times are refused, repeated autumn times take the first).
// Rolling: the same local time in every market's own zone, with a market's own
// spring-forward gap time shifted forward by the gap's length.
export function resolveGoLive(input: GoLiveInput, zones: { market: string; timeZone: string }[]): MarketInstant[] | GapTimeError | null {
  if (input.type === 'simultaneous') {
    let instant: Date | null = null;
    if (input.goLiveAt) instant = parseInstant(input.goLiveAt);
    else if (input.copenhagenGoLive) {
      const local = parseLocalDateTime(input.copenhagenGoLive);
      if (local) {
        try { instant = cphLocal(local); } catch (e) { return e instanceof GapTimeError ? e : null; }
      }
    }
    if (!instant) return null;
    return zones.map(z => ({ market: z.market, goLiveAt: instant }));
  }
  const local = input.localGoLive ? parseLocalDateTime(input.localGoLive) : null;
  if (!local) return null;
  const out: MarketInstant[] = [];
  for (const z of zones) {
    const zone = zoneOf(z.timeZone);
    let ldt = local;
    if (isGapAt(zone, local)) ldt = local.plusHours(1);
    out.push({ market: z.market, goLiveAt: localToInstant(ldt, z.timeZone) });
  }
  return out;
}

// ISO weeks and week labels follow the Copenhagen calendar — decided here alone.
export interface IsoWeek { key: string; label: string; year: number; week: number; }

export function isoWeekOf(dateStr: string): IsoWeek {
  const d = LocalDate.parse(dateStr);
  const year = d.get(IsoFields.WEEK_BASED_YEAR);
  const week = d.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR);
  return { key: `${year}-W${pad2(week)}`, label: `Week ${week} · ${year}`, year, week };
}

export function formatMoney(amountMinor: number, currency: string): string {
  const decimals = currency === 'JPY' ? 0 : 2;
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(Math.round(amountMinor));
  let s: string;
  if (decimals === 0) {
    s = groupThousands(abs);
  } else {
    const units = Math.floor(abs / 100);
    const cents = abs % 100;
    s = `${groupThousands(units)}.${pad2(cents)}`;
  }
  return `${sign}${currency} ${s}`;
}

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// A countdown reads HH:MM:SS, prefixed with "<d>d " once at least a day remains.
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00:00:00';
  const total = Math.floor(msRemaining / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const core = `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return d > 0 ? `${d}d ${core}` : core;
}
