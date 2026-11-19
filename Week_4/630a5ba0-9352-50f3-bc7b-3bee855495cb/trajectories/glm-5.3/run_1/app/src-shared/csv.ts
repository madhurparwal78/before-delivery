export interface CsvRowResult {
  readonly line: number;
  readonly externalId: string;
  readonly title: string;
  readonly estimateMinutes: number | null;
  readonly dueDate: string | null;
  readonly source: string;
}

export interface CsvRejected {
  readonly line: number;
  readonly reason: string;
}

export interface CsvParseResult {
  readonly rows: readonly CsvRowResult[];
  readonly rejected: readonly CsvRejected[];
}

/** Parses one CSV field, honouring quoted fields with escaped quotes and commas. */
function splitCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (inQuotes) return null;
  fields.push(cur);
  return fields;
}

export const ESTIMATE_OK = (value: number): boolean => value >= 5 && value <= 600 && (value - 5) % 5 === 0;
export const DATE_OK = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));

/**
 * The single rule for parsing a task-export CSV.
 * The header row is line 1; row line numbers count the header.
 */
export function parseTaskCsv(text: string, maxRows: number): { result: CsvParseResult | null; tooManyRows: boolean } {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return { result: null, tooManyRows: false };
  const header = splitCsvLine(lines[0] ?? '');
  if (header === null) return { result: null, tooManyRows: false };
  const columns = header.map((h) => h.trim().toLowerCase());
  const idIdx = columns.indexOf('external_id');
  const titleIdx = columns.indexOf('title');
  if (idIdx === -1 || titleIdx === -1) return { result: null, tooManyRows: false };
  const estIdx = columns.indexOf('estimate_minutes');
  const dueIdx = columns.indexOf('due_date');
  const sourceIdx = columns.indexOf('source');

  const dataLines = lines.slice(1);
  if (dataLines.length > maxRows) return { result: null, tooManyRows: true };

  const rows: CsvRowResult[] = [];
  const rejected: CsvRejected[] = [];
  for (let i = 0; i < dataLines.length; i++) {
    const lineNo = i + 2; // header is line 1
    const raw = splitCsvLine(dataLines[i] ?? '');
    if (raw === null) {
      rejected.push({ line: lineNo, reason: 'malformed quoting' });
      continue;
    }
    const externalId = (raw[idIdx] ?? '').trim();
    const title = (raw[titleIdx] ?? '').trim();
    let failed: string | null = null;
    if (externalId.length === 0) failed = 'missing external_id';
    if (title.length === 0 && failed === null) failed = 'missing title';
    let estimateMinutes: number | null = null;
    if (failed === null && estIdx !== -1) {
      const cell = (raw[estIdx] ?? '').trim();
      if (cell.length > 0) {
        const n = Number(cell);
        if (!Number.isInteger(n) || !ESTIMATE_OK(n)) failed = 'invalid estimate_minutes';
        else estimateMinutes = n;
      }
    }
    let dueDate: string | null = null;
    if (failed === null && dueIdx !== -1) {
      const cell = (raw[dueIdx] ?? '').trim();
      if (cell.length > 0) {
        if (!DATE_OK(cell)) failed = 'invalid due_date';
        else dueDate = cell;
      }
    }
    if (failed !== null) {
      rejected.push({ line: lineNo, reason: failed });
      continue;
    }
    const source = sourceIdx !== -1 ? (raw[sourceIdx] ?? '').trim() : '';
    rows.push({
      line: lineNo,
      externalId,
      title,
      estimateMinutes,
      dueDate,
      source: source.length > 0 ? source : 'csv',
    });
  }
  return { result: { rows, rejected }, tooManyRows: false };
}
