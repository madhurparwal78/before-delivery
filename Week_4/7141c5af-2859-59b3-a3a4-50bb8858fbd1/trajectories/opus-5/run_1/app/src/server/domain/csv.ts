/**
 * The old workbook's format and the materials list file's format.
 */

export const WORKBOOK_COLUMNS = ['client', 'piece', 'maker', 'year', 'stamp', 'material', 'notes'] as const;
export type WorkbookColumn = (typeof WORKBOOK_COLUMNS)[number];

export const MATERIALS_LIST_COLUMNS = ['piece', 'client', 'material', 'code', 'lot', 'hides', 'notes'] as const;

/** Reads the bytes as UTF-8, with or without a byte order mark. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  let view = bytes;
  if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    view = view.subarray(3);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    return null;
  }
}

/** Comma or semicolon, as decided by the header row. */
export function detectDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        i += 1;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      break;
    } else if (!quoted && ch === ',') {
      commas += 1;
    } else if (!quoted && ch === ';') {
      semicolons += 1;
    }
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * Records, not lines: a line break inside a quoted field stays in the field and
 * does not move the numbering.
 */
export function parseCsv(text: string, delimiter: ',' | ';'): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push(row);
    row = [];
    started = false;
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      started = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      endField();
      started = true;
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      if (started || row.length > 0 || field !== '') endRecord();
      i += 1;
      continue;
    }
    field += ch;
    started = true;
    i += 1;
  }
  if (started || row.length > 0 || field !== '') endRecord();
  return records;
}

export type HeaderProblem =
  | { kind: 'extra'; name: string }
  | { kind: 'missing'; name: string };

/**
 * The header row is exactly the published columns, read by name. An extra
 * column refuses the whole file, tested first; then a missing one.
 */
export function checkHeader(header: readonly string[]): HeaderProblem | null {
  const known = new Set<string>(WORKBOOK_COLUMNS);
  for (const name of header) {
    if (!known.has(name)) return { kind: 'extra', name };
  }
  for (const name of WORKBOOK_COLUMNS) {
    if (!header.includes(name)) return { kind: 'missing', name };
  }
  return null;
}

// ------------------------------------------------------------ materials list

const DANGEROUS_STARTS = ['=', '+', '-', '@', '\t', '\r'];

/** A cell that could be read as a formula carries an apostrophe. */
export function guardCell(value: string): string {
  return DANGEROUS_STARTS.some((c) => value.startsWith(c)) ? `'${value}` : value;
}

function quoteCell(value: string): string {
  return `"${guardCell(value).replace(/"/g, '""')}"`;
}

/** Comma separated, every field quoted, CRLF line ends. */
export function writeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(quoteCell).join(',')).join('\r\n') + '\r\n';
}
