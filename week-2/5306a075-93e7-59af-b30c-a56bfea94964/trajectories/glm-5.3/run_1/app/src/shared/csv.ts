/**
 * CSV reading for the legacy feedback import (DP-15, DP-16, DP-48) and CSV
 * writing for the ranked feature export (DP-32, DP-33).
 */

export const IMPORT_HEADER = [
  "contact_email",
  "contact_name",
  "company_name",
  "feedback",
  "received_on",
];

export const MAX_IMPORT_ROWS = 2000;

export interface ParsedRecord {
  line: number;
  fields: string[];
}

export interface ParseResult {
  headerOk: boolean;
  records: ParsedRecord[];
  tooManyRows: boolean;
}

/**
 * Read a pasted legacy CSV: an optional UTF-8 BOM, LF or CRLF endings (mixed
 * allowed), standard quoting, and records that may span physical lines.
 * `line` is the physical line on which the record starts, header is line 1.
 */
export function parseCsv(input: string): ParseResult {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records: ParsedRecord[] = [];
  let headerOk = false;
  let tooManyRows = false;
  let seenHeader = false;

  // Split into physical lines keeping the quotes intact.
  const lines = splitLines(text);
  let i = 0;
  let recordStartLine = 0;
  let buffer = "";
  let inRecord = false;
  const flush = (): void => {
    if (!inRecord) return;
    const fields = parseQuotedLine(buffer);
    if (!seenHeader) {
      seenHeader = true;
      headerOk =
        fields.length === IMPORT_HEADER.length &&
        fields.every((f, idx) => f.trim().toLowerCase() === IMPORT_HEADER[idx]);
    } else if (records.length >= MAX_IMPORT_ROWS) {
      tooManyRows = true;
    } else {
      records.push({ line: recordStartLine, fields });
    }
    inRecord = false;
    buffer = "";
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (!inRecord) {
      // A blank line outside a record yields no record.
      if (line === "") {
        i++;
        continue;
      }
      recordStartLine = i + 1;
      buffer = line;
      inRecord = true;
    } else {
      buffer += "\n" + line;
    }
    // Quote parity is counted over the whole record so that a quoted field
    // may span physical lines.
    const quoteCount = (buffer.match(/"/g) ?? []).length;
    if (quoteCount % 2 === 0) {
      flush();
    }
    i++;
  }
  flush();
  return { headerOk, records, tooManyRows };
}

function splitLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\r") {
      lines.push(current);
      current = "";
      if (text[i + 1] === "\n") i++;
    } else if (ch === "\n") {
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  lines.push(current);
  return lines;
}

/** Parse one logical line with standard CSV quoting. */
export function parseQuotedLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      fields.push(field);
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  fields.push(field);
  return fields;
}

/** Quote a CSV cell: fields with a comma, quote or line break are quoted. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Formula neutralisation (DP-33): a cell whose first character is `=`, `+`,
 * `-`, `@`, a tab or a carriage return gets one apostrophe in front, before
 * quoting.
 */
export function neutraliseFormula(value: string): string {
  const first = value.charAt(0);
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    return `'${value}`;
  }
  return value;
}

/** One CSV cell, neutralised then quoted. */
export function exportCell(value: string): string {
  return csvCell(neutraliseFormula(value));
}

/** Join export cells into one CRLF-terminated line. */
export function exportLine(cells: string[]): string {
  return cells.map(exportCell).join(",") + "\r\n";
}
