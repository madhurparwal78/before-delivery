import { compactJson } from './json';
import { numberText } from './numbers';
import { DocDate, DocObject, DocValue, isPlainObject, parseDateText } from './values';

export interface CsvRecord {
  line: number;
  cells: string[];
}

/** Splits CSV text into records, numbering each by its first physical line. */
export function parseCsvRecords(text: string): CsvRecord[] {
  const body = text.startsWith('\ufeff') ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let index = 0;
  let line = 1;
  while (index < body.length) {
    if (body[index] === '\n') {
      index += 1;
      line += 1;
      continue;
    }
    if (body[index] === '\r' && body[index + 1] === '\n') {
      index += 2;
      line += 1;
      continue;
    }
    const startLine = line;
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    let done = false;
    while (index < body.length && !done) {
      const char = body[index];
      if (quoted) {
        if (char === '"') {
          if (body[index + 1] === '"') {
            cell += '"';
            index += 2;
          } else {
            quoted = false;
            index += 1;
          }
        } else {
          if (char === '\n') line += 1;
          cell += char;
          index += 1;
        }
        continue;
      }
      if (char === '"' && cell === '') {
        quoted = true;
        index += 1;
      } else if (char === ',') {
        cells.push(cell);
        cell = '';
        index += 1;
      } else if (char === '\r' && body[index + 1] === '\n') {
        index += 2;
        line += 1;
        done = true;
      } else if (char === '\n') {
        index += 1;
        line += 1;
        done = true;
      } else {
        cell += char;
        index += 1;
      }
    }
    cells.push(cell);
    records.push({ line: startLine, cells });
  }
  return records;
}

const CSV_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CSV_NUMBER = /^-?\d+(\.\d+)?$/;

/** A CSV cell's inferred value, or undefined for an empty cell. */
export function csvCellValue(cell: string): DocValue | undefined {
  if (cell === '') return undefined;
  if (cell === 'true') return true;
  if (cell === 'false') return false;
  if (cell === 'null') return null;
  if (CSV_NUMBER.test(cell)) return Number(cell);
  if (CSV_DATE.test(cell)) {
    const date = parseDateText(cell);
    if (date) return date;
  }
  return cell;
}

export function buildCsvRow(doc: DocObject, headers: string[], cells: string[]): DocObject {
  const out: DocObject = doc;
  headers.forEach((header, position) => {
    const value = csvCellValue(cells[position]);
    if (value === undefined) return;
    const segments = header.split('.');
    let target = out;
    for (let depth = 0; depth < segments.length - 1; depth += 1) {
      const segment = segments[depth];
      const existing = target[segment];
      if (isPlainObject(existing)) {
        target = existing;
      } else {
        const created: DocObject = {};
        target[segment] = created;
        target = created;
      }
    }
    target[segments[segments.length - 1]] = value;
  });
  return out;
}

/** The scalar leaf paths of a document, descending into objects only. */
function leafPaths(value: DocValue, prefix: string, out: Set<string>): void {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.add(prefix);
      return;
    }
    for (const key of keys) leafPaths(value[key], prefix ? `${prefix}.${key}` : key, out);
    return;
  }
  out.add(prefix);
}

export function csvColumns(docs: DocObject[]): string[] {
  const paths = new Set<string>();
  for (const doc of docs) {
    for (const key of Object.keys(doc)) leafPaths(doc[key], key, paths);
  }
  const columns = Array.from(paths);
  columns.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return columns;
}

function valueAtLeafPath(doc: DocObject, path: string): DocValue | undefined {
  const segments = path.split('.');
  let current: DocValue = doc;
  for (const segment of segments) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function cellText(value: DocValue | undefined): { text: string; isNumber: boolean } {
  if (value === undefined) return { text: '', isNumber: false };
  if (value === null) return { text: 'null', isNumber: false };
  if (value instanceof DocDate) return { text: value.text(), isNumber: false };
  if (typeof value === 'number') return { text: numberText(value), isNumber: true };
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false', isNumber: false };
  if (typeof value === 'string') return { text: value, isNumber: false };
  return { text: compactJson(value), isNumber: false };
}

const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r']);

function guardCell(text: string, isNumber: boolean): string {
  if (isNumber || text.length === 0) return text;
  return FORMULA_START.has(text[0]) ? `'${text}` : text;
}

function quoteCell(text: string): string {
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** A spreadsheet-safe CSV download of whole documents. */
export function buildCsv(docs: DocObject[]): string {
  const columns = csvColumns(docs);
  const lines: string[] = [];
  lines.push(columns.map((column) => quoteCell(guardCell(column, false))).join(','));
  for (const doc of docs) {
    lines.push(
      columns
        .map((column) => {
          const cell = cellText(valueAtLeafPath(doc, column));
          return quoteCell(guardCell(cell.text, cell.isNumber));
        })
        .join(','),
    );
  }
  return lines.map((line) => `${line}\r\n`).join('');
}

/** A JSON-lines download of whole documents. */
export function buildJsonLines(docs: DocObject[]): string {
  return docs.map((doc) => `${compactJson(doc)}\n`).join('');
}
