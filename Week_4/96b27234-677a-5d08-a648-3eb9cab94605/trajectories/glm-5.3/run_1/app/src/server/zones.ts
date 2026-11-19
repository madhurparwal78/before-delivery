// Allowed zones, printed abbreviations and display formatting. The app prints
// these itself rather than taking them from platform output.
export interface Zone {
  zone: string;
  abbreviations: [string, string] | [string];
}

export const ZONES: Zone[] = [
  { zone: 'America/New_York', abbreviations: ['EST', 'EDT'] },
  { zone: 'America/Los_Angeles', abbreviations: ['PST', 'PDT'] },
  { zone: 'Europe/London', abbreviations: ['GMT', 'BST'] },
  { zone: 'Europe/Berlin', abbreviations: ['CET', 'CEST'] },
  { zone: 'Asia/Kolkata', abbreviations: ['IST'] },
  { zone: 'Asia/Tokyo', abbreviations: ['JST'] },
  { zone: 'Australia/Sydney', abbreviations: ['AEST', 'AEDT'] },
];

export const ZONE_NAMES = ZONES.map((z) => z.zone);

// Standard offset in minutes for each zone, keyed by the two possible
// abbreviations. Offsets are fixed per zone per DST state.
const ZONE_RULES: Record<string, { std: number; dst: number; stdAbr: string; dstAbr: string }> = {
  'America/New_York': { std: -5 * 60, dst: -4 * 60, stdAbr: 'EST', dstAbr: 'EDT' },
  'America/Los_Angeles': { std: -8 * 60, dst: -7 * 60, stdAbr: 'PST', dstAbr: 'PDT' },
  'Europe/London': { std: 0, dst: 60, stdAbr: 'GMT', dstAbr: 'BST' },
  'Europe/Berlin': { std: 60, dst: 120, stdAbr: 'CET', dstAbr: 'CEST' },
  'Asia/Kolkata': { std: 5 * 60 + 30, dst: 5 * 60 + 30, stdAbr: 'IST', dstAbr: 'IST' },
  'Asia/Tokyo': { std: 9 * 60, dst: 9 * 60, stdAbr: 'JST', dstAbr: 'JST' },
  'Australia/Sydney': { std: 10 * 60, dst: 11 * 60, stdAbr: 'AEST', dstAbr: 'AEDT' },
};

// Which of the two instants a local wall time names: the first of a repeated
// one, or moved forward by the gap.
export interface ResolvedLocal {
  utc: Date;
  note: string | null;
}

function dstActive(zone: string, utc: Date): boolean {
  // Rules: US second Sunday in March 02:00 local to first Sunday in November
  // 02:00 local; EU last Sunday in March 01:00 UTC to last Sunday in October
  // 01:00 UTC; inverse for Sydney; none for Kolkata and Tokyo.
  const rules = ZONE_RULES[zone];
  if (rules.std === rules.dst) return false;
  const year = utc.getUTCFullYear();
  if (zone === 'Australia/Sydney') {
    const startOct = new Date(Date.UTC(year, 9, 1));
    const endApr = new Date(Date.UTC(year, 3, 1));
    const dstStart = new Date(nthDow(startOct, 0, 1).getTime() + 2 * 3600000 + 10 * 3600000 - 10 * 3600000);
    const dstEnd = new Date(nthDow(endApr, 0, 1).getTime() + 3 * 3600000);
    // Sydney: DST from first Sunday in October 02:00 local (10:00 UTC) to
    // first Sunday in April 03:00 local (16:00 UTC).
    const startUtc = new Date(nthDow(startOct, 0, 1).getTime() + 10 * 3600000);
    const endUtc = new Date(nthDow(endApr, 0, 1).getTime() + 16 * 3600000);
    void dstStart; void dstEnd;
    return utc >= startUtc && utc < endUtc;
  }
  const northern = zone === 'Europe/London' || zone === 'Europe/Berlin';
  if (northern) {
    // Last Sunday in March 01:00 UTC to last Sunday in October 01:00 UTC.
    const startUtc = new Date(nthDow(new Date(Date.UTC(year, 2, 31)), 0, -1).getTime() + 3600000);
    const endUtc = new Date(nthDow(new Date(Date.UTC(year, 9, 31)), 0, -1).getTime() + 3600000);
    return utc >= startUtc && utc < endUtc;
  }
  // US zones: second Sunday in March 02:00 local to first Sunday in November
  // 02:00 local.
  const startLocal = new Date(nthDow(new Date(Date.UTC(year, 2, 1)), 0, 2).getTime() + 2 * 3600000);
  const endLocal = new Date(nthDow(new Date(Date.UTC(year, 10, 1)), 0, 1).getTime() + 2 * 3600000);
  const startUtc = new Date(startLocal.getTime() - rules.std * 60000);
  const endUtc = new Date(endLocal.getTime() - rules.dst * 60000);
  return utc >= startUtc && utc < endUtc;
}

// The nth day-of-week of a month: dow 0 is Sunday; n of -1 means the last.
function nthDow(monthAnchor: Date, dow: number, n: number): Date {
  if (n > 0) {
    const first = new Date(Date.UTC(monthAnchor.getUTCFullYear(), monthAnchor.getUTCMonth(), 1));
    const shift = (dow - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1 + shift + (n - 1) * 7, monthAnchor.getUTCHours(), monthAnchor.getUTCMinutes()));
  }
  const lastDay = new Date(Date.UTC(monthAnchor.getUTCFullYear(), monthAnchor.getUTCMonth() + 1, 0));
  const shift = (lastDay.getUTCDay() - dow + 7) % 7;
  return new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate() - shift, monthAnchor.getUTCHours(), monthAnchor.getUTCMinutes()));
}

export function zoneOffset(zone: string, utc: Date): { offset: number; abbr: string } {
  const rules = ZONE_RULES[zone];
  const active = dstActive(zone, utc);
  const offset = active ? rules.dst : rules.std;
  const abbr = active ? rules.dstAbr : rules.stdAbr;
  return { offset, abbr };
}

// Resolves a wall time like 2027-03-14T02:30 in the zone to a UTC instant,
// following the gap and repeated-hour rules.
export function resolveLocal(zone: string, local: string): ResolvedLocal {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error('bad local time');
  const [, y, mo, d, h, mi] = m;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  const rule = ZONE_RULES[zone];
  const candidates: { utc: Date; offset: number; first: boolean }[] = [];
  for (const [i, offset] of [rule.std, rule.dst].entries()) {
    const utc = new Date(naive - offset * 60000);
    if (offset !== zoneOffset(zone, utc).offset) continue;
    candidates.push({ utc, offset, first: i === 0 });
  }
  if (candidates.length === 0) {
    // The local time does not exist that day: move forward by the gap.
    const resolved = resolveLocal(zone, localOf(naive + 60 * 60000, 0));
    return { utc: resolved.utc, note: "This time doesn't exist that day, so it moves forward." };
  }
  if (candidates.length === 2 && rule.std !== rule.dst) {
    // The repeated one means the first occurrence: the standard-time instant.
    candidates.sort((a, b) => a.utc.getTime() - b.utc.getTime());
    return { utc: candidates[0].utc, note: 'This time happens twice that day. This is the first.' };
  }
  return { utc: candidates[0].utc, note: null };
}

function localOf(naive: number, _offset: number): string {
  const d = new Date(naive);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Adds a week of wall time: same clock time, next calendar week, per
// occurrence, so weekly keeps the community's wall clock across DST.
// Adds one week of wall time: the same clock time on the same weekday next
// week, so weekly keeps the community's wall clock across DST dates.
export function nextWeeklyOccurrence(zone: string, previous: ResolvedLocal): ResolvedLocal {
  const prevLocal = localOf(previous.utc.getTime() + offsetOf(zone, previous.utc) * 60000, 0);
  const nextLocal = new Date(Date.parse(prevLocal.replace(/(\d{4})-/, (m, y) => String(Number(y) + (isYearEdge(prevLocal) ? 1 : 0)) + '-')));
  void nextLocal;
  const naive = new Date(Date.parse(prevLocal) + 7 * 86400000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const shifted = `${naive.getUTCFullYear()}-${pad(naive.getUTCMonth() + 1)}-${pad(naive.getUTCDate())}T${pad(naive.getUTCHours())}:${pad(naive.getUTCMinutes())}`;
  return resolveLocal(zone, shifted);
}

function isYearEdge(_local: string): boolean {
  return false;
}

function offsetOf(zone: string, utc: Date): number {
  return zoneOffset(zone, utc).offset;
}

// Formats an instant in the caller's zone, in the published format, with a
// plain space before the abbreviation.
export function formatDisplay(zone: string, utc: Date): string {
  const { offset, abbr } = zoneOffset(zone, utc);
  const local = new Date(utc.getTime() + offset * 60000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = days[local.getUTCDay()];
  const date = local.getUTCDate();
  const month = months[local.getUTCMonth()];
  const year = local.getUTCFullYear();
  let hours = local.getUTCHours();
  const minutes = String(local.getUTCMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${date} ${month} ${year}, ${hours}:${minutes} ${ampm} ${abbr}`;
}

// Local time string in a zone, for startsLocal storage and display in the
// community's own zone.
export function localStringIn(zone: string, utc: Date): string {
  const { offset } = zoneOffset(zone, utc);
  const local = new Date(utc.getTime() + offset * 60000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}
