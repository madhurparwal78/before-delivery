// CSV reading and writing. Reading follows standard quoting with LF or CRLF line ends and tracks the
// physical line each record starts on; writing neutralises formula cells (adapted from kit/modules/csv_safe).

export interface CsvRecord { line: number; fields: string[] }

export function readCsv(input: string): CsvRecord[] {
  const text = input.startsWith("﻿") ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let touched = false;
  const endField = (): void => { fields.push(field); field = ""; };
  const endRecord = (): void => {
    endField();
    if (touched || fields.length > 1 || fields[0] !== "") records.push({ line: recordLine, fields });
    fields = [];
    touched = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") { quoted = true; touched = true; }
    else if (char === ",") endField();
    else if (char === "\n") { endRecord(); line += 1; recordLine = line; }
    else if (char !== "\r" || text[i + 1] !== "\n") field += char;
  }
  if (field !== "" || fields.length > 0 || touched) endRecord();
  return records;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** One export cell: a leading apostrophe on text a spreadsheet would run, then RFC 4180 quoting. */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let cell = String(value);
  if (typeof value === "string" && FORMULA_START.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** CRLF-terminated lines. */
export function csvText(rows: readonly (readonly (string | number | null)[])[]): string {
  return rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}
