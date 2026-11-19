import { instantFromWallClock, isKnownTimeZone } from '../../shared/time.js';

export interface ParsedEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
}

export interface ParsedCalendar {
  events: ParsedEvent[];
  skipped: number;
}

interface ContentLine {
  name: string;
  params: Map<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }
    unfolded.push(line);
  }
  return unfolded;
}

function parseLine(raw: string): ContentLine | null {
  const colon = raw.indexOf(':');
  if (colon < 0) return null;
  const left = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  const segments = left.split(';');
  const name = (segments.shift() ?? '').toUpperCase();
  const params = new Map<string, string>();
  for (const segment of segments) {
    const equals = segment.indexOf('=');
    if (equals < 0) continue;
    params.set(segment.slice(0, equals).toUpperCase(), segment.slice(equals + 1).replace(/^"|"$/g, ''));
  }
  return { name, params, value };
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

type TimeValue =
  | { kind: 'instant'; instant: Date }
  | { kind: 'date' }
  | { kind: 'floating' }
  | { kind: 'invalid' };

function parseTimeValue(line: ContentLine): TimeValue {
  const value = line.value.trim();
  if (line.params.get('VALUE') === 'DATE' || /^\d{8}$/.test(value)) return { kind: 'date' };
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) return { kind: 'invalid' };
  const wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const seconds = Number(match[6]);
  if (match[7] === 'Z') {
    return {
      kind: 'instant',
      instant: new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, seconds)),
    };
  }
  const tzid = line.params.get('TZID');
  if (tzid === undefined || !isKnownTimeZone(tzid)) return { kind: 'floating' };
  const instant = new Date(instantFromWallClock(wall, tzid).getTime() + seconds * 1000);
  return { kind: 'instant', instant };
}

function parseDuration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const weeks = Number(match[2] ?? 0);
  const days = Number(match[3] ?? 0);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);
  const total = ((weeks * 7 + days) * 24 * 3600 + hours * 3600 + minutes * 60 + seconds) * 1000;
  return total === 0 ? null : sign * total;
}

export function looksLikeCalendar(text: string): boolean {
  return /BEGIN:VCALENDAR/i.test(text);
}

/**
 * Imports only timed, non-repeating VEVENTs that carry a UID, a DTSTART and an end.
 * Every other VEVENT counts once in `skipped`.
 */
export function parseCalendar(text: string): ParsedCalendar {
  const lines = unfold(text);
  const events: ParsedEvent[] = [];
  let skipped = 0;
  let inEvent = false;
  let depth = 0;
  let current: ContentLine[] = [];

  for (const raw of lines) {
    const upper = raw.toUpperCase();
    if (upper.startsWith('BEGIN:VEVENT')) {
      inEvent = true;
      depth = 0;
      current = [];
      continue;
    }
    if (!inEvent) continue;
    if (upper.startsWith('END:VEVENT')) {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      inEvent = false;
      const parsed = buildEvent(current);
      if (parsed) events.push(parsed);
      else skipped += 1;
      continue;
    }
    if (upper.startsWith('BEGIN:')) {
      depth += 1;
      continue;
    }
    if (upper.startsWith('END:')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    const line = parseLine(raw);
    if (line) current.push(line);
  }

  return { events, skipped };
}

function buildEvent(lines: ContentLine[]): ParsedEvent | null {
  const find = (name: string): ContentLine | undefined =>
    lines.find((line) => line.name === name);

  if (find('RRULE')) return null;
  const uid = find('UID')?.value.trim();
  if (!uid) return null;
  const dtstart = find('DTSTART');
  if (!dtstart) return null;
  const start = parseTimeValue(dtstart);
  if (start.kind !== 'instant') return null;

  const dtend = find('DTEND');
  let end: Date | null = null;
  if (dtend) {
    const parsedEnd = parseTimeValue(dtend);
    if (parsedEnd.kind !== 'instant') return null;
    end = parsedEnd.instant;
  } else {
    const duration = find('DURATION');
    if (!duration) return null;
    const millis = parseDuration(duration.value);
    if (millis === null || millis <= 0) return null;
    end = new Date(start.instant.getTime() + millis);
  }
  if (end.getTime() <= start.instant.getTime()) return null;

  return {
    uid,
    summary: unescapeText(find('SUMMARY')?.value.trim() ?? 'Meeting'),
    start: start.instant,
    end,
  };
}
