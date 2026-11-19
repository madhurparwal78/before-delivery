import type { FieldType } from '../../shared/types.js';
import { config } from '../config.js';

export interface UploadError {
  line: number | null;
  message: string;
}

export interface ParsedCsv {
  header: string[];
  records: { line: number; cells: (string | null)[] }[];
  errors: UploadError[];
  rowCount: number;
}

const NULL_TOKENS = new Set(['', 'na', 'null']);

function nullable(cell: string): string | null {
  return NULL_TOKENS.has(cell.trim().toLowerCase()) ? null : cell;
}

interface RawRecord {
  line: number;
  cells: string[];
}

function scan(text: string): { records: RawRecord[]; unterminatedQuoteLine: number | null } {
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let line = 1;
  let recordLine = 1;
  let i = 0;
  let started = false;

  const endRecord = (): void => {
    cells.push(cell);
    cell = '';
    records.push({ line: recordLine, cells });
    cells = [];
    started = false;
  };

  while (i < text.length) {
    const ch = text[i];
    if (!started) {
      recordLine = line;
      started = true;
    }
    if (ch === '"') {
      const quoteLine = line;
      i += 1;
      let closed = false;
      while (i < text.length) {
        const c = text[i];
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        if (c === '\n') line += 1;
        cell += c;
        i += 1;
      }
      if (!closed) return { records, unterminatedQuoteLine: quoteLine };
      continue;
    }
    if (ch === ',') {
      cells.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      endRecord();
      line += 1;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (started) endRecord();
  return { records, unterminatedQuoteLine: null };
}

function only(message: string, line: number | null = null): ParsedCsv {
  return { header: [], records: [], rowCount: 0, errors: [{ line, message }] };
}

export function parseCsv(bytes: Uint8Array): ParsedCsv {
  if (bytes.byteLength > config.csvMaxBytes) {
    return only(`File is ${bytes.byteLength} bytes. The limit is ${config.csvMaxBytes}.`);
  }
  const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
  const { records: raw, unterminatedQuoteLine } = scan(text);

  if (raw.length === 0) {
    if (unterminatedQuoteLine !== null) {
      return only(`Line ${unterminatedQuoteLine}: unterminated quote.`, unterminatedQuoteLine);
    }
    return only('File is empty.');
  }

  const header = raw[0].cells.map((c) => c.trim());
  const dataRecords = raw.slice(1);
  if (dataRecords.length === 0 && unterminatedQuoteLine === null) return only('File is empty.');

  const errors: UploadError[] = [];
  const counts = new Map<string, number>();
  let duplicate: string | null = null;
  for (const name of header) {
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    if (count === 2 && duplicate === null && name !== '') duplicate = name;
  }
  if (duplicate !== null) {
    errors.push({ line: 1, message: `Line 1: duplicate column name "${duplicate}".` });
  } else {
    const emptyAt = header.findIndex((n) => n === '');
    if (emptyAt >= 0) errors.push({ line: 1, message: `Line 1: column ${emptyAt + 1} has no name.` });
  }

  const good: { line: number; cells: (string | null)[] }[] = [];
  for (const rec of dataRecords) {
    if (rec.cells.length !== header.length) {
      errors.push({
        line: rec.line,
        message: `Line ${rec.line}: expected ${header.length} fields, found ${rec.cells.length}.`,
      });
      continue;
    }
    good.push({ line: rec.line, cells: rec.cells.map(nullable) });
  }
  if (unterminatedQuoteLine !== null) {
    errors.push({ line: unterminatedQuoteLine, message: `Line ${unterminatedQuoteLine}: unterminated quote.` });
  }
  errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  if (good.length > config.rowMax) {
    errors.push({ line: null, message: `Table has ${good.length} rows. The limit is ${config.rowMax}.` });
  }
  return { header, records: good, rowCount: good.length, errors };
}

const BOOLEANS = new Set(['true', 'false', 'yes', 'no']);
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export function inferType(values: (string | null)[]): FieldType {
  const present = values.filter((v): v is string => v !== null).map((v) => v.trim());
  if (present.length === 0) return 'text';
  if (present.every((v) => BOOLEANS.has(v.toLowerCase()))) return 'boolean';
  if (present.every((v) => NUMBER_RE.test(v))) return 'number';
  if (present.every((v) => DATE_RE.test(v) || TIMESTAMP_RE.test(v))) return 'date';
  return 'text';
}

export type CellData = string | number | boolean | null;

export function coerce(value: string | null, type: FieldType): CellData {
  if (value === null) return null;
  const t = value.trim();
  switch (type) {
    case 'boolean': {
      const low = t.toLowerCase();
      return low === 'true' || low === 'yes';
    }
    case 'number':
      return Number(t);
    case 'date': {
      if (DATE_RE.test(t)) return `${t}T00:00:00.000Z`;
      return new Date(Date.parse(t.replace(' ', 'T'))).toISOString();
    }
    default:
      return value;
  }
}

export interface TableData {
  columns: { name: string; type: FieldType }[];
  rows: Record<string, CellData>[];
}

export function buildTable(parsed: ParsedCsv): TableData {
  const columns = parsed.header.map((name, idx) => ({
    name,
    type: inferType(parsed.records.map((r) => r.cells[idx])),
  }));
  const rows = parsed.records.map((rec) => {
    const row: Record<string, CellData> = {};
    columns.forEach((col, idx) => {
      row[col.name] = coerce(rec.cells[idx], col.type);
    });
    return row;
  });
  return { columns, rows };
}
