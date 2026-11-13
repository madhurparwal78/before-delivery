import type { Weekday, Difficulty, TaskType } from '../shared/rules.js';
import { WEEKDAYS } from '../shared/rules.js';

export interface ParsedLine {
  line: number;
  type: TaskType;
  title: string;
  difficulty: Difficulty;
  weekdays?: Weekday[];
  checklist?: string[];
  price?: number;
}

export interface ParseError {
  line: number;
  message: string;
}

/**
 * The .deedlist format: line 1 is exactly `DEEDLIST 1`; blank lines and
 * `#` comments are skipped; every other line is pipe-separated. Any error
 * rejects the whole file. This is the single place the format is decided.
 */
export function parseDeedlist(text: string): { lines: ParsedLine[]; errors: ParseError[] } {
  const raw = text.split(/\r\n|\r|\n/);
  const errors: ParseError[] = [];
  const lines: ParsedLine[] = [];

  if ((raw[0] ?? '') !== 'DEEDLIST 1') {
    return { lines: [], errors: [{ line: 1, message: 'Line 1: the first line must be DEEDLIST 1' }] };
  }

  for (let i = 1; i < raw.length; i++) {
    const lineNo = i + 1;
    const rawLine = raw[i];
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const fields = rawLine.split('|').map((f) => f.trim());
    const type = fields[0];

    if (type !== 'habit' && type !== 'daily' && type !== 'todo' && type !== 'reward') {
      errors.push({ line: lineNo, message: `Line ${lineNo}: unknown task type "${type}"` });
      continue;
    }

    const expected = type === 'daily' ? 4 : type === 'todo' ? '3 or 4' : 3;
    const okCount =
      type === 'todo' ? fields.length === 3 || fields.length === 4 : fields.length === expected;
    if (!okCount) {
      errors.push({
        line: lineNo,
        message: `Line ${lineNo}: expected ${expected} fields, found ${fields.length}`,
      });
      continue;
    }

    const lineErrors: string[] = [];
    const title = fields[1] ?? '';
    if (title.length < 1 || title.length > 80) {
      lineErrors.push(`Line ${lineNo}: title must be 1 to 80 characters`);
    }
    // Rewards carry a price where other types carry a difficulty.
    const isReward = type === 'reward';
    const difficulty = (fields[2] ?? '') as Difficulty;
    if (!isReward && !['trivial', 'easy', 'medium', 'hard'].includes(difficulty)) {
      lineErrors.push(`Line ${lineNo}: difficulty must be trivial, easy, medium or hard`);
    }

    const parsed: ParsedLine = {
      line: lineNo,
      type: type as TaskType,
      title,
      difficulty: (['trivial', 'easy', 'medium', 'hard'].includes(difficulty)
        ? difficulty
        : 'easy') as Difficulty,
    };

    if (type === 'daily') {
      const weekdayStr = fields[3] ?? '';
      const parts = weekdayStr
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const valid = parts.length > 0 && parts.every((p) => (WEEKDAYS as readonly string[]).includes(p));
      const unique = new Set(parts).size === parts.length;
      if (!valid || !unique) {
        lineErrors.push(`Line ${lineNo}: weekdays must be chosen from Mon, Tue, Wed, Thu, Fri, Sat, Sun`);
      } else {
        parsed.weekdays = WEEKDAYS.filter((w) => parts.includes(w));
      }
    }

    if (type === 'todo') {
      if (fields.length === 4) {
        const items = (fields[3] ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        parsed.checklist = items;
      }
    }

    if (type === 'reward') {
      const priceStr = fields[2] ?? '';
      const price = Number(priceStr);
      const ok =
        priceStr !== '' &&
        Number.isFinite(price) &&
        /^\d+(\.\d{1,2})?$/.test(priceStr) &&
        price >= 0.01 &&
        price <= 9999.99;
      if (!ok) {
        lineErrors.push(`Line ${lineNo}: price must be a number from 0.01 to 9999.99`);
      } else {
        parsed.price = Math.round(price * 100);
      }
    } else {
      // habit, daily and todo share the difficulty field at index 2.
    }

    if (lineErrors.length > 0) {
      errors.push(...lineErrors.map((message) => ({ line: lineNo, message })));
      continue;
    }
    lines.push(parsed);
  }

  return { lines, errors };
}
