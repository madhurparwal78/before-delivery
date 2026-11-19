export type ColumnType = "boolean" | "number" | "date" | "text";

export interface CsvError {
  line: number | null;
  message: string;
}

export interface ParsedCsv {
  columns: string[];
  rows: string[][];
  errors: CsvError[];
}

export interface ColumnMeta {
  name: string;
  type: ColumnType;
}

const NULL_TOKENS = new Set(["", "na", "null"]);

export function isNullCell(v: string): boolean {
  return NULL_TOKENS.has(v.toLowerCase());
}

export function looksNumber(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v);
}

export function looksDate(v: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.exec(v);
  if (!m) return false;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

export function looksBoolean(v: string): boolean {
  const t = v.toLowerCase();
  return t === "true" || t === "false" || t === "yes" || t === "no";
}

export function inferType(values: string[]): ColumnType {
  const nonNull = values.filter((v) => !isNullCell(v));
  if (nonNull.length === 0) return "text";
  if (nonNull.every(looksBoolean)) return "boolean";
  if (nonNull.every(looksNumber)) return "number";
  if (nonNull.every(looksDate)) return "date";
  return "text";
}

export interface ParseLimit {
  rowMax: number;
}

/**
 * Parse a CSV body. Returns every record with the physical line number where
 * the record starts, plus the errors in line order. RFC 4180 quoting; a final
 * empty line after the last line break is ignored.
 */
export function parseCsv(bytes: Buffer, limits: ParseLimit): {
  columns: ColumnMeta[];
  records: (string | null)[][];
  errors: CsvError[];
  rowCount: number;
} {
  const errors: CsvError[] = [];
  const text = bytes.toString("utf8");
  const records: { line: number; cells: (string | null)[] }[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let field = "";
  let rowCells: string[] = [];
  let rowStartLine = 1;
  let inQuotes = false;
  let headerDone = false;
  const headerRow: (string | null)[] = [];
  let quoteOpenLine = 1;

  const pushRecord = (): void => {
    if (!headerDone) {
      for (const c of rowCells) headerRow.push(c);
      headerDone = true;
    } else {
      records.push({ line: rowStartLine, cells: rowCells });
    }
    rowCells = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      quoteOpenLine = line;
      i++;
      continue;
    }
    if (ch === ",") {
      rowCells.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
      rowCells.push(field);
      field = "";
      // A final empty line after the last line break is ignored, and a lone
      // empty line inside the body is not a record.
      const isEmptyLine = rowCells.length === 1 && rowCells[0] === "";
      if (!isEmptyLine) pushRecord();
      else rowCells = [];
      line++;
      rowStartLine = line;
      continue;
    }
    field += ch;
    i++;
  }

  if (inQuotes) {
    errors.push({ line: quoteOpenLine, message: `Line ${quoteOpenLine}: unterminated quote.` });
    const keep = records.filter((r) => r.line < quoteOpenLine);
    return finish(headerRow, keep, errors, limits);
  }

  if (field !== "" || rowCells.length > 0) {
    rowCells.push(field);
    pushRecord();
  }

  return finish(headerRow, records, errors, limits);
}

function finish(
  headerRow: (string | null)[],
  records: { line: number; cells: (string | null)[] }[],
  errors: CsvError[],
  limits: ParseLimit,
): {
  columns: ColumnMeta[];
  records: (string | null)[][];
  errors: CsvError[];
  rowCount: number;
} {
  const header = headerRow;
  const seenNames = new Set<string>();
  for (let c = 0; c < header.length; c++) {
    const name = header[c] ?? "";
    if (name === "") {
      errors.push({ line: 1, message: `Line 1: column ${c + 1} has no name.` });
    } else if (seenNames.has(name)) {
      errors.push({ line: 1, message: `Line 1: duplicate column name "${name}".` });
    } else {
      seenNames.add(name);
    }
  }
  const width = header.length;
  for (const r of records) {
    if (r.cells.length !== width) {
      errors.push({
        line: r.line,
        message: `Line ${r.line}: expected ${width} fields, found ${r.cells.length}.`,
      });
    }
  }
  if (records.length > limits.rowMax) {
    errors.push({ line: null, message: `Table has ${records.length} rows. The limit is ${limits.rowMax}.` });
  }
  const columnTypes: ColumnType[] = [];
  for (let c = 0; c < width; c++) {
    const vals: string[] = [];
    for (const r of records) {
      const cell = r.cells[c] ?? null;
      if (cell === null || isNullCell(cell)) continue;
      vals.push(cell);
    }
    columnTypes.push(inferType(vals));
  }
  const cells: (string | null)[][] = records.map((r) => {
    const row: (string | null)[] = [];
    for (let c = 0; c < width; c++) {
      const raw = r.cells[c];
      if (raw === undefined || raw === null) row.push(null);
      else if (isNullCell(raw)) row.push(null);
      else row.push(raw);
    }
    return row;
  });
  return {
    columns: header.map((h, idx) => ({ name: h ?? "", type: columnTypes[idx] })),
    records: cells,
    errors,
    rowCount: cells.length,
  };
}

