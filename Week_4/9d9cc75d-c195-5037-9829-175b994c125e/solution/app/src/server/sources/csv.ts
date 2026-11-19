// RFC 4180 parsing, null cells, the four type inference rules and the upload error list. Pure: no I/O, no clock.
import type { Cell, ValueType } from '../../shared/model.ts';
import { formatCount } from '../../shared/display.ts';

interface UploadError {
  line: number | null;
  message: string;
}

interface CsvLimits {
  csvMaxBytes: number;
  rowMax: number;
}

interface CsvRecord {
  /** The physical line where the record starts. */
  line: number;
  fields: string[];
}

const EMPTY_FILE = 'File is empty.';

export const sizeMessage = (size: number, max: number): string =>
  `File is ${formatCount(size)} bytes. The limit is ${formatCount(max)}.`;

const rowsMessage = (rows: number, max: number): string =>
  `Table has ${formatCount(rows)} rows. The limit is ${formatCount(max)}.`;

const LF = 10;
const COMMA = 44;
const QUOTE = 34;
const CR = 13;

/**
 * Walks `text` record by record. A final empty line after the last line break is ignored. Returns the line where an
 * unterminated quote opened (the walk stops there and that record is not reported), else null.
 */
function scanCsv(text: string, onRecord: (record: CsvRecord) => void): number | null {
  const end = text.length;
  let pos = 0;
  let line = 1;
  while (pos < end) {
    const startLine = line;
    const fields: string[] = [];
    for (;;) {
      let value: string;
      if (text.charCodeAt(pos) === QUOTE) {
        const openedAt = line;
        value = '';
        pos++;
        for (;;) {
          const close = text.indexOf('"', pos);
          if (close === -1) return openedAt;
          const chunk = text.slice(pos, close);
          for (let i = 0; i < chunk.length; i++) if (chunk.charCodeAt(i) === LF) line++;
          value += chunk;
          if (text.charCodeAt(close + 1) === QUOTE) {
            value += '"';
            pos = close + 2;
          } else {
            pos = close + 1;
            break;
          }
        }
        const stop = fieldEnd(text, pos);
        value += trimCr(text, pos, stop);
        pos = stop;
      } else {
        const stop = fieldEnd(text, pos);
        value = trimCr(text, pos, stop);
        pos = stop;
      }
      fields.push(value);
      if (pos >= end) break;
      if (text.charCodeAt(pos) === COMMA) {
        pos++;
        if (pos >= end) {
          fields.push('');
          break;
        }
      } else {
        pos++;
        line++;
        break;
      }
    }
    onRecord({ line: startLine, fields });
  }
  return null;
}

function fieldEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === COMMA || c === LF) break;
    i++;
  }
  return i;
}

function trimCr(text: string, from: number, stop: number): string {
  const cut = stop < text.length && stop > from && text.charCodeAt(stop - 1) === CR ? stop - 1 : stop;
  return text.slice(from, cut);
}

interface ParsedCsv {
  records: CsvRecord[];
  unterminatedLine: number | null;
}

export function parseCsv(text: string): ParsedCsv {
  const records: CsvRecord[] = [];
  const unterminatedLine = scanCsv(text, (record) => records.push(record));
  return { records, unterminatedLine };
}

/** An empty cell, or `NA` or `null` in any case. */
export function isNullText(text: string): boolean {
  if (text === '') return true;
  const lower = text.toLowerCase();
  return lower === 'na' || lower === 'null';
}

const BOOLEAN_WORDS = new Set(['true', 'false', 'yes', 'no']);
const NUMBER = /^-?\d+(\.\d+)?$/;
const DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2}))?$/;

/** `YYYY-MM-DD` or an ISO 8601 timestamp with an offset, as UTC epoch milliseconds; null when it is neither. */
export function parseDate(text: string): number | null {
  const m = DATE.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hour = Number(m[4] ?? 0);
  const minute = Number(m[5] ?? 0);
  const second = Number(m[6] ?? 0);
  const millis = Math.floor(Number(`0.${m[7] ?? '0'}`) * 1000);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const moment = new Date(0);
  moment.setUTCFullYear(year, month - 1, day);
  moment.setUTCHours(hour, minute, second, millis);
  if (moment.getUTCMonth() !== month - 1 || moment.getUTCDate() !== day) return null;
  const zone = m[8];
  if (zone === undefined || zone === 'Z') return moment.getTime();
  const sign = zone.startsWith('-') ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  const offsetMinutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
  return moment.getTime() - sign * offsetMinutes * 60000;
}

function isBooleanText(text: string): boolean {
  return BOOLEAN_WORDS.has(text.toLowerCase());
}

function isNumberText(text: string): boolean {
  return NUMBER.test(text) && Number.isFinite(Number(text));
}

/** The first rule that holds for every non-null value; a column of nulls is text. */
export function inferType(values: readonly string[]): ValueType {
  let boolean = true;
  let number = true;
  let date = true;
  let seen = false;
  for (const text of values) {
    if (isNullText(text)) continue;
    seen = true;
    if (boolean && !isBooleanText(text)) boolean = false;
    if (number && !isNumberText(text)) number = false;
    if (date && parseDate(text) === null) date = false;
    if (!boolean && !number && !date) return 'text';
  }
  if (!seen) return 'text';
  if (boolean) return 'boolean';
  if (number) return 'number';
  return date ? 'date' : 'text';
}

/** One cell of a column of `type`; null for a null cell or a value the type cannot hold. Dates are epoch ms. */
export function convertCell(text: string, type: ValueType): Cell {
  if (isNullText(text)) return null;
  switch (type) {
    case 'text':
      return text;
    case 'boolean':
      return isBooleanText(text) ? ['true', 'yes'].includes(text.toLowerCase()) : null;
    case 'number':
      return isNumberText(text) ? Number(text) : null;
    case 'date':
      return parseDate(text);
  }
}

export interface Column {
  name: string;
  type: ValueType;
}

export interface CsvTable {
  columns: Column[];
  /** Every data record as written (quotes removed), in file order. */
  records: string[][];
  /** The typed cells of `records`. */
  rows: Cell[][];
}

/** Column types from the header and data records. */
function inferTable(header: readonly string[], records: readonly string[][]): CsvTable {
  const columns = header.map((name, index) => ({ name, type: inferType(records.map((r) => r[index] ?? '')) }));
  const rows = records.map((record) => columns.map((column, index) => convertCell(record[index] ?? '', column.type)));
  return { columns, records: records.slice(), rows };
}

type CsvResult = { ok: true; table: CsvTable } | { ok: false; errors: UploadError[] };

/** Parses and checks a submitted file. Any error means nothing is stored. */
export function readCsv(bytes: Uint8Array, limits: CsvLimits): CsvResult {
  if (bytes.length > limits.csvMaxBytes) {
    return { ok: false, errors: [{ line: null, message: sizeMessage(bytes.length, limits.csvMaxBytes) }] };
  }
  if (bytes.length === 0) return { ok: false, errors: [{ line: null, message: EMPTY_FILE }] };

  const decoded = new TextDecoder('utf-8').decode(bytes);
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  const nul = text.indexOf('\u0000');
  if (nul !== -1) {
    // PostgreSQL text and JSON cannot hold a NUL character.
    const line = text.slice(0, nul).split('\n').length;
    return { ok: false, errors: [{ line, message: `Line ${line}: the file contains a NUL character.` }] };
  }
  const errors: UploadError[] = [];
  const head: { names: string[] | null } = { names: null };
  const records: string[][] = [];
  let dataRows = 0;

  const unterminated = scanCsv(text, (record) => {
    const header = head.names;
    if (header === null) {
      head.names = record.fields;
      const problem = headerProblem(record.fields);
      if (problem) errors.push({ line: 1, message: problem });
      return;
    }
    dataRows++;
    if (record.fields.length !== header.length) {
      errors.push({
        line: record.line,
        message: `Line ${record.line}: expected ${header.length} fields, found ${record.fields.length}.`,
      });
    } else if (dataRows <= limits.rowMax) {
      records.push(record.fields);
    }
  });

  if (unterminated === null && dataRows === 0) return { ok: false, errors: [{ line: null, message: EMPTY_FILE }] };
  if (unterminated !== null) {
    errors.push({ line: unterminated, message: `Line ${unterminated}: unterminated quote.` });
  }
  if (dataRows > limits.rowMax) errors.push({ line: null, message: rowsMessage(dataRows, limits.rowMax) });
  if (errors.length > 0 || head.names === null) return { ok: false, errors };
  return { ok: true, table: inferTable(head.names, records) };
}

function headerProblem(header: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const name of header) {
    if (name !== '' && seen.has(name)) return `Line 1: duplicate column name "${name}".`;
    seen.add(name);
  }
  const unnamed = header.indexOf('');
  return unnamed === -1 ? null : `Line 1: column ${unnamed + 1} has no name.`;
}
