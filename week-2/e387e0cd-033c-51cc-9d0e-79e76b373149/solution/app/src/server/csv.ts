// CSV reading (RFC 4180, the import) and writing (the regulator's monthly file, adapted from kit/modules/csv_safe).

const FORMULA_START = /^[=+\-@\t\r]/;

/** Every field quoted, inner quotes doubled, formula-like text neutralised with a leading apostrophe. */
export function csvLine(values: (string | null)[]): string {
  return values
    .map((value) => {
      const text = value ?? "";
      const safe = FORMULA_START.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    })
    .join(",") + "\r\n";
}

/** Rows of cells; accepts a byte order mark, LF or CRLF line ends and quoted fields. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
}
