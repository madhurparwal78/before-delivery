import { isoInstant, localTimeOf } from './domain.js';

export interface ParsedEvent {
  readonly uid: string;
  readonly summary: string;
  readonly start: Date;
  readonly end: Date;
}

export interface IcsParseResult {
  readonly imported: readonly ParsedEvent[];
  readonly skipped: number;
}

/** Unescapes iCalendar text values. */
function unescapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === 'n' || next === 'N') out += '\n';
      else if (next === '\\' || next === ';' || next === ',') out += next;
      else out += next;
      i++;
    } else {
      out += value[i];
    }
  }
  return out;
}

interface ContentLine {
  readonly name: string;
  readonly params: Record<string, string>;
  readonly value: string;
}

function unfold(content: string): string[] {
  const lines: string[] = [];
  let current = '';
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const rawLine of normalized.split('\n')) {
    if (rawLine.startsWith(' ') || rawLine.startsWith('\t')) {
      current += rawLine.slice(1);
    } else {
      if (current.length > 0) lines.push(current);
      current = rawLine;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function parseLine(line: string): ContentLine | null {
  const colonInProps = line.indexOf(':');
  if (colonInProps === -1) return null;
  let name = line;
  let params: Record<string, string> = {};
  let value: string;
  const firstColon = line.indexOf(':');
  const before = line.slice(0, firstColon);
  const after = line.slice(firstColon + 1);
  const semi = before.indexOf(';');
  if (semi === -1) {
    name = before.toUpperCase();
    params = {};
    value = after;
  } else {
    name = before.slice(0, semi).toUpperCase();
    const rawParams = before.slice(semi + 1);
    const map: Record<string, string> = {};
    for (const p of rawParams.split(';')) {
      const eq = p.indexOf('=');
      if (eq === -1) continue;
      map[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    params = map;
    value = after;
  }
  return { name, params, value };
}

function parseIcsDateTime(value: string, params: Record<string, string>): Date | null | 'all_day' | 'floating' {
  const v = value.trim();
  if (/^\d{8}$/.test(v)) return 'all_day';
  const m = /^(\d{8})T(\d{6})(Z?)$/.exec(v);
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  const ymd = m[1];
  const hms = m[2];
  const z = m[3];
  const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
  if (z === 'Z') return new Date(Date.parse(iso + 'Z'));
  if (typeof params.TZID === 'string' && params.TZID.length > 0) {
    // Convert the local wall clock in the IANA zone to an instant via wallStamp offsets.
    const zone = params.TZID;
    const dateStr = iso.slice(0, 10);
    const hhmmStr = iso.slice(11, 16);
    return wallInstant(dateStr, hhmmStr, zone);
  }
  return 'floating';
}

const DAY_MS = 86_400_000;

function wallInstant(dateStr: string, hhmm: string, timeZone: string): Date | null {
  const naive = Date.parse(`${dateStr}T${hhmm}:00Z`);
  if (Number.isNaN(naive)) return null;
  const candidates = [naive, naive - DAY_MS, naive + DAY_MS];
  let best: number | null = null;
  for (const c of candidates) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(c));
    const get = (t: string): string => {
      const p = parts.find((x) => x.type === t);
      return p === undefined ? '00' : p.value;
    };
    const stamp = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
    if (stamp === `${dateStr}T${hhmm}` && (best === null || c < best)) best = c;
  }
  return best === null ? null : new Date(best);
}

function parseDuration(text: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text.trim());
  if (m === null) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const weeks = m[2] === undefined ? 0 : Number(m[2]);
  const days = m[3] === undefined ? 0 : Number(m[3]);
  const hours = m[4] === undefined ? 0 : Number(m[4]);
  const minutes = m[5] === undefined ? 0 : Number(m[5]);
  const seconds = m[6] === undefined ? 0 : Number(m[6]);
  const totalSeconds = ((weeks * 7 + days) * 24 * 3600) + hours * 3600 + minutes * 60 + seconds;
  return totalSeconds === 0 ? null : sign * totalSeconds * 1000;
}

/** The single rule for what an .ics import accepts. */
export function parseIcs(content: string): IcsParseResult {
  const lines = unfold(content).map(parseLine).filter((l): l is ContentLine => l !== null);
  const imported: ParsedEvent[] = [];
  let skipped = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined || line.name !== 'BEGIN' || line.value.trim().toUpperCase() !== 'VEVENT') {
      i++;
      continue;
    }
    // collect this VEVENT's properties
    const props: ContentLine[] = [];
    i++;
    while (i < lines.length) {
      const inner = lines[i];
      if (inner === undefined) break;
      if (inner.name === 'END' && inner.value.trim().toUpperCase() === 'VEVENT') {
        i++;
        break;
      }
      if (inner.name === 'BEGIN') {
        // skip nested components entirely (e.g. VALARM)
        const nested = inner.value.trim().toUpperCase();
        i++;
        let depth = 1;
        while (i < lines.length && depth > 0) {
          const l2 = lines[i];
          if (l2 === undefined) break;
          if (l2.name === 'BEGIN') depth++;
          if (l2.name === 'END' && l2.value.trim().toUpperCase() === nested) depth--;
          i++;
        }
        continue;
      }
      props.push(inner);
      i++;
    }
    const uidProp = props.find((p) => p.name === 'UID');
    const dtstartProp = props.find((p) => p.name === 'DTSTART');
    const dtendProp = props.find((p) => p.name === 'DTEND');
    const durationProp = props.find((p) => p.name === 'DURATION');
    const summaryProp = props.find((p) => p.name === 'SUMMARY');
    const rruleProp = props.find((p) => p.name === 'RRULE');

    const reject = (): void => {
      skipped++;
    };

    if (uidProp === undefined || uidProp.value.trim().length === 0) {
      reject();
      continue;
    }
    if (rruleProp !== undefined) {
      reject();
      continue;
    }
    if (dtstartProp === undefined) {
      reject();
      continue;
    }
    const start = parseIcsDateTime(dtstartProp.value, dtstartProp.params);
    if (start === null || start === 'all_day' || start === 'floating') {
      reject();
      continue;
    }
    let end: Date | null | 'all_day' | 'floating' = null;
    if (dtendProp !== undefined) {
      end = parseIcsDateTime(dtendProp.value, dtendProp.params);
      if (end === null || end === 'all_day' || end === 'floating') {
        reject();
        continue;
      }
    } else if (durationProp !== undefined) {
      const ms = parseDuration(durationProp.value);
      if (ms === null || ms <= 0) {
        reject();
        continue;
      }
      end = new Date(start.getTime() + ms);
    } else {
      reject();
      continue;
    }
    if (end.getTime() <= start.getTime()) {
      reject();
      continue;
    }
    imported.push({
      uid: uidProp.value.trim(),
      summary: summaryProp === undefined ? '' : unescapeText(summaryProp.value),
      start,
      end,
    });
  }
  return { imported, skipped };
}

export interface FeedEvent {
  readonly uid: string;
  readonly summary: string;
  readonly start: Date;
  readonly end: Date;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function icsUtcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Serialises the private calendar feed. One VEVENT per session or occurrence. */
export function buildFeedIcs(events: readonly FeedEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Tidemark Daybook//Feed//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${icsUtcStamp(new Date())}`,
      `DTSTART:${icsUtcStamp(e.start)}`,
      `DTEND:${icsUtcStamp(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function overlapsLocalDay(start: Date, end: Date, dateStr: string, timeZone: string): boolean {
  // The local day [00:00 next midnight) in UTC instants.
  const dayStart = wallInstant(dateStr, '00:00', timeZone);
  const dayEnd = wallInstant(shiftDay(dateStr, 1), '00:00', timeZone);
  if (dayStart === null || dayEnd === null) return false;
  return start.getTime() < dayEnd.getTime() && end.getTime() > dayStart.getTime();
}

function shiftDay(dateStr: string, days: number): string {
  const d = new Date(Date.parse(dateStr + 'T00:00:00Z'));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minutes of an event that overlap a local day. */
export function overlapMinutes(start: Date, end: Date, dateStr: string, timeZone: string): number {
  const dayStart = wallInstant(dateStr, '00:00', timeZone);
  const dayEnd = wallInstant(shiftDay(dateStr, 1), '00:00', timeZone);
  if (dayStart === null || dayEnd === null) return 0;
  const from = Math.max(start.getTime(), dayStart.getTime());
  const to = Math.min(end.getTime(), dayEnd.getTime());
  if (to <= from) return 0;
  return Math.round((to - from) / 60000);
}

/** Local start/end HH:MM of an event relative to a given local date. */
export function localTimesForDate(start: Date, end: Date, dateStr: string, timeZone: string): { startTime: string; endTime: string } {
  // Relative to the local date, the start is either its own local time on that date, or the day's 00:00 start.
  const dayStart = wallInstant(dateStr, '00:00', timeZone);
  const dayEnd = wallInstant(shiftDay(dateStr, 1), '00:00', timeZone);
  const startInstant = dayStart !== null && start.getTime() > dayStart.getTime() ? start : dayStart ?? start;
  const endInstant = dayEnd !== null && end.getTime() < dayEnd.getTime() ? end : dayEnd ?? end;
  const startTime = localTimeOf(startInstant, timeZone);
  const endStamp = wallStampFor(endInstant, timeZone);
  const endTime = endStamp.slice(0, 10) === dateStr ? endStamp.slice(11, 16) : '23:59';
  return { startTime, endTime };
}

function wallStampFor(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(instant);
  const get = (t: string): string => {
    const p = parts.find((x) => x.type === t);
    return p === undefined ? '00' : p.value;
  };
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export const toIsoInstant = isoInstant;
