import { createHash } from 'node:crypto';
import { query, withTx } from './db';
import { addDays, datesBetween, isDate, isoWeekday } from './zone';

export interface ImportErrorLine {
  line: number;
  key: string;
  params: Record<string, string | number>;
}

interface ValidLine {
  line: number;
  room: string;
  from: string;
  to: string;
  weekdays: boolean[];
  rate_minor: number;
  min_stay: number | null;
  max_stay: number | null;
}

export interface ImportChange {
  room: string;
  date: string;
  old_minor: number;
  new_minor: number;
}

export interface ParsedImport {
  errors: ImportErrorLine[];
  lines: ValidLine[];
}

const WEEKDAY_LETTERS = 'MTWTFSS';

function wholeNumber(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** Parses and validates a KIPRATES 1 file against the property's room types. */
export function parseImport(text: string, roomTypes: string[]): ParsedImport {
  const rawLines = text.split(/\r?\n/);
  const errors: ImportErrorLine[] = [];
  if ((rawLines[0] ?? '') !== 'KIPRATES 1') {
    return { errors: [{ line: 1, key: 'import.header', params: { n: 1 } }], lines: [] };
  }
  const valid: ValidLine[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const lineNumber = i + 1;
    const raw = rawLines[i];
    if (raw.trim() === '' || raw.startsWith('#')) continue;
    const fields = raw.split('|');
    if (fields.length !== 8) {
      errors.push({ line: lineNumber, key: 'import.fields', params: { n: lineNumber, m: fields.length } });
      continue;
    }
    const [room, plan, from, to, weekdays, rate, min, max] = fields;
    if (!roomTypes.includes(room)) {
      errors.push({ line: lineNumber, key: 'import.room', params: { n: lineNumber, x: room } });
      continue;
    }
    if (plan !== 'refundable') {
      errors.push({ line: lineNumber, key: 'import.plan', params: { n: lineNumber, x: plan } });
      continue;
    }
    if (!isDate(from)) {
      errors.push({ line: lineNumber, key: 'import.date', params: { n: lineNumber, x: from } });
      continue;
    }
    if (!isDate(to)) {
      errors.push({ line: lineNumber, key: 'import.date', params: { n: lineNumber, x: to } });
      continue;
    }
    if (from > to) {
      errors.push({ line: lineNumber, key: 'import.order', params: { n: lineNumber, from, to } });
      continue;
    }
    if (!validWeekdays(weekdays)) {
      errors.push({ line: lineNumber, key: 'import.weekdays', params: { n: lineNumber, x: weekdays } });
      continue;
    }
    const rateValue = wholeNumber(rate);
    if (rateValue === null || rateValue <= 0) {
      errors.push({ line: lineNumber, key: 'import.rate', params: { n: lineNumber } });
      continue;
    }
    const minValue = min === '' ? null : wholeNumber(min);
    const maxValue = max === '' ? null : wholeNumber(max);
    const badMin = min !== '' && (minValue === null || minValue < 1);
    const badMax = max !== '' && (maxValue === null || maxValue < 1);
    const badOrder = minValue !== null && maxValue !== null && maxValue < minValue;
    if (badMin || badMax || badOrder) {
      errors.push({ line: lineNumber, key: 'import.limits', params: { n: lineNumber, x: `${min}|${max}` } });
      continue;
    }
    valid.push({
      line: lineNumber,
      room,
      from,
      to,
      weekdays: weekdayFlags(weekdays),
      rate_minor: rateValue,
      min_stay: minValue,
      max_stay: maxValue,
    });
  }
  for (let i = 0; i < valid.length; i++) {
    for (let j = 0; j < i; j++) {
      if (overlaps(valid[i], valid[j])) {
        errors.push({
          line: valid[i].line,
          key: 'import.overlap',
          params: { n: valid[i].line, m: valid[j].line },
        });
        break;
      }
    }
  }
  errors.sort((a, b) => a.line - b.line);
  return { errors, lines: errors.length > 0 ? [] : valid };
}

function validWeekdays(raw: string): boolean {
  if (raw.length !== 7) return false;
  for (let i = 0; i < 7; i++) {
    if (raw[i] !== '-' && raw[i] !== WEEKDAY_LETTERS[i]) return false;
  }
  return true;
}

function weekdayFlags(raw: string): boolean[] {
  return Array.from({ length: 7 }, (_, i) => raw[i] !== '-');
}

function nightsOf(line: ValidLine): string[] {
  return datesBetween(line.from, addDays(line.to, 1)).filter((date) => line.weekdays[isoWeekday(date) - 1]);
}

function overlaps(a: ValidLine, b: ValidLine): boolean {
  if (a.room !== b.room) return false;
  if (a.from > b.to || b.from > a.to) return false;
  const nights = new Set(nightsOf(b));
  return nightsOf(a).some((date) => nights.has(date));
}

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The nights a valid file would change, ordered by room then date. */
export async function previewChanges(lines: ValidLine[]): Promise<ImportChange[]> {
  const wanted = new Map<string, ValidLine>();
  for (const line of lines) {
    for (const date of nightsOf(line)) wanted.set(`${line.room}|${date}`, line);
  }
  const keys = [...wanted.keys()].sort();
  const changes: ImportChange[] = [];
  const rooms = [...new Set(lines.map((line) => line.room))];
  const existing = new Map<string, { base_rate_minor: number; min_stay: number; max_stay: number }>();
  if (rooms.length > 0) {
    const rows = await query<{ room_type: string; date: string; base_rate_minor: number; min_stay: number; max_stay: number }>(
      `select room_type, to_char(date, 'YYYY-MM-DD') as date, base_rate_minor, min_stay, max_stay
       from nights where room_type = any($1)`,
      [rooms],
    );
    for (const row of rows) {
      existing.set(`${row.room_type}|${row.date}`, {
        base_rate_minor: row.base_rate_minor,
        min_stay: row.min_stay,
        max_stay: row.max_stay,
      });
    }
  }
  for (const key of keys) {
    const line = wanted.get(key)!;
    const [room, date] = key.split('|');
    const current = existing.get(key);
    if (!current) continue;
    const rateChanged = current.base_rate_minor !== line.rate_minor;
    const minChanged = line.min_stay !== null && current.min_stay !== line.min_stay;
    const maxChanged = line.max_stay !== null && current.max_stay !== line.max_stay;
    if (rateChanged || minChanged || maxChanged) {
      changes.push({ room, date, old_minor: current.base_rate_minor, new_minor: line.rate_minor });
    }
  }
  return changes;
}

export async function applyImport(lines: ValidLine[]): Promise<string[]> {
  const touched = new Set<string>();
  await withTx(async (client) => {
    for (const line of lines) {
      const dates = nightsOf(line);
      for (const date of dates) touched.add(date);
      const sets = ['base_rate_minor = $3'];
      const params: unknown[] = [line.room, dates, line.rate_minor];
      if (line.min_stay !== null) {
        params.push(line.min_stay);
        sets.push(`min_stay = $${params.length}`);
      }
      if (line.max_stay !== null) {
        params.push(line.max_stay);
        sets.push(`max_stay = $${params.length}`);
      }
      await client.query(
        `update nights set ${sets.join(', ')} where room_type = $1 and date = any($2::date[])`,
        params,
      );
    }
  });
  return [...touched].sort();
}
