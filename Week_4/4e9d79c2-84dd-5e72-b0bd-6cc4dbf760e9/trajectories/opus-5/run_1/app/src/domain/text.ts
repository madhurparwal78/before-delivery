import { randomInt } from 'node:crypto';

export const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function makeReference(): string {
  let body = '';
  for (let index = 0; index < 5; index += 1) body += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `CV-${body}`;
}

export function foldEmail(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

export function foldTelephone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('44') ? `0${digits.slice(2)}` : digits;
}

export function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function isEmailAddress(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim());
}

export function isUkTelephone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const folded = foldTelephone(value);
  return /^0\d{9,10}$/.test(folded);
}

/** Postcodes print upper case with one space before the last three characters. */
export function formatPostcode(value: string): string {
  const bare = value.replace(/\s+/g, '').toUpperCase();
  if (bare.length < 4) return bare;
  return `${bare.slice(0, bare.length - 3)} ${bare.slice(bare.length - 3)}`;
}

const STATEMENT_LETTER_READINGS: Record<string, string> = { O: '0', I: '1', L: '1' };

/** A reference found anywhere in a statement description. */
export function findReference(description: string): string | null {
  const pattern = /CV[-\s]*([0-9A-Za-z]{5})(?![0-9A-Za-z])/gi;
  for (const match of description.matchAll(pattern)) {
    const raw = match[1].toUpperCase();
    let body = '';
    let good = true;
    for (const character of raw) {
      const read = STATEMENT_LETTER_READINGS[character] ?? character;
      if (!REFERENCE_ALPHABET.includes(read)) {
        good = false;
        break;
      }
      body += read;
    }
    if (good) return `CV-${body}`;
  }
  return null;
}

export type CsvRow = { row: number; cells: string[] };

/** Reads UTF-8 CSV text, with or without a byte order mark, LF or CRLF, and a final line or not. */
export function readCsv(text: string, separator = ','): CsvRow[] {
  const body = text.replace(/^\uFEFF/, '');
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  const pushCell = (): void => {
    cells.push(cell);
    cell = '';
  };
  const pushRow = (): void => {
    pushCell();
    rows.push({ row: line, cells });
    cells = [];
    line += 1;
  };
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quoted) {
      if (character === '"') {
        if (body[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === separator) {
      pushCell();
      continue;
    }
    if (character === '\r') continue;
    if (character === '\n') {
      pushRow();
      continue;
    }
    cell += character;
  }
  if (cell !== '' || cells.length > 0) pushRow();
  return rows;
}

const RISKY_STARTS = ['=', '+', '-', '@'];

/** Neutralises risky cell starts with a straight apostrophe. */
export function safeCell(value: string): string {
  const text = value ?? '';
  const start = text.slice(0, 1);
  const body = RISKY_STARTS.includes(start) ? `'${text}` : text;
  return /[",\n]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body;
}

export function writeCsv(header: string[], rows: string[][]): string {
  const lines = [header.map(safeCell).join(','), ...rows.map((row) => row.map(safeCell).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** A file name that reaches the browser with its own letters. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
