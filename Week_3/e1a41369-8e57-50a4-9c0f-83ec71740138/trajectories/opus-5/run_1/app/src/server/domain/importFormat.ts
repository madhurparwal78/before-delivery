import type { Difficulty, ImportLineError, Weekday } from '../../shared/types.js';
import { WEEKDAYS } from '../time.js';
import { DIFFICULTIES } from './rewards.js';

export const IMPORT_HEADER = 'DEEDLIST 1';

export interface ParsedImportTask {
  line: number;
  type: 'habit' | 'daily' | 'todo' | 'reward';
  title: string;
  difficulty: Difficulty | null;
  weekdays: Weekday[] | null;
  checklist: string[] | null;
  priceCents: number | null;
}

export interface ParsedImport {
  tasks: ParsedImportTask[];
  errors: ImportLineError[];
}

const EXPECTED_FIELDS: Record<string, { count: string; matches: (found: number) => boolean }> = {
  habit: { count: '3', matches: (found) => found === 3 },
  daily: { count: '4', matches: (found) => found === 4 },
  todo: { count: '3 or 4', matches: (found) => found === 3 || found === 4 },
  reward: { count: '3', matches: (found) => found === 3 },
};

function parseWeekdays(raw: string): Weekday[] | null {
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length === 0) return null;
  const chosen: Weekday[] = [];
  for (const part of parts) {
    if (!(WEEKDAYS as string[]).includes(part)) return null;
    const day = part as Weekday;
    if (chosen.includes(day)) return null;
    chosen.push(day);
  }
  if (chosen.length === 0) return null;
  return WEEKDAYS.filter((day) => chosen.includes(day));
}

function parsePriceCents(raw: string): number | null {
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  if (cents < 1 || cents > 999_999) return null;
  return cents;
}

/** Checks an import file against the published format. Any error rejects the whole file. */
export function parseImportFile(content: string): ParsedImport {
  const lines = content.split(/\r?\n/);
  const errors: ImportLineError[] = [];
  const tasks: ParsedImportTask[] = [];

  if ((lines[0] ?? '') !== IMPORT_HEADER) {
    return { tasks: [], errors: [{ line: 1, message: `Line 1: the first line must be ${IMPORT_HEADER}` }] };
  }

  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index] as string;
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const fields = raw.split('|').map((field) => field.trim());
    const type = fields[0] ?? '';
    const expected = EXPECTED_FIELDS[type];
    if (!expected) {
      errors.push({ line, message: `Line ${line}: unknown task type "${type}"` });
      continue;
    }
    if (!expected.matches(fields.length)) {
      errors.push({ line, message: `Line ${line}: expected ${expected.count} fields, found ${fields.length}` });
      continue;
    }

    const lineErrors: ImportLineError[] = [];
    const title = fields[1] ?? '';
    if (title.length < 1 || title.length > 80) {
      lineErrors.push({ line, message: `Line ${line}: title must be 1 to 80 characters` });
    }

    let difficulty: Difficulty | null = null;
    let weekdays: Weekday[] | null = null;
    let checklist: string[] | null = null;
    let priceCents: number | null = null;

    if (type === 'reward') {
      priceCents = parsePriceCents(fields[2] ?? '');
      if (priceCents === null) {
        lineErrors.push({ line, message: `Line ${line}: price must be a number from 0.01 to 9999.99` });
      }
    } else {
      const difficultyRaw = fields[2] ?? '';
      if ((DIFFICULTIES as string[]).includes(difficultyRaw)) difficulty = difficultyRaw as Difficulty;
      else lineErrors.push({ line, message: `Line ${line}: difficulty must be trivial, easy, medium or hard` });

      if (type === 'daily') {
        weekdays = parseWeekdays(fields[3] ?? '');
        if (weekdays === null) {
          lineErrors.push({
            line,
            message: `Line ${line}: weekdays must be chosen from Mon, Tue, Wed, Thu, Fri, Sat, Sun`,
          });
        }
      }
      if (type === 'todo') {
        checklist = (fields[3] ?? '')
          .split(';')
          .map((item) => item.trim())
          .filter((item) => item !== '');
      }
    }

    if (lineErrors.length > 0) {
      errors.push(...lineErrors);
      continue;
    }
    tasks.push({
      line,
      type: type as ParsedImportTask['type'],
      title,
      difficulty,
      weekdays,
      checklist,
      priceCents,
    });
  }

  if (errors.length > 0) return { tasks: [], errors };
  return { tasks, errors };
}

/** An import file's bytes must be valid UTF-8 text without a NUL byte, under a `.deedlist` name. */
export function importFileIsText(filename: string, bytes: Buffer): boolean {
  if (!filename.toLowerCase().endsWith('.deedlist')) return false;
  if (bytes.includes(0)) return false;
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (decoded.includes('\uFFFD')) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return false;
    }
  }
  return true;
}
