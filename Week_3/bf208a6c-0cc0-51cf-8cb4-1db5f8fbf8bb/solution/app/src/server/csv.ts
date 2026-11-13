// CSV formula neutralisation (adapted from kit/modules/csv_safe): RFC 4180 quoting plus a leading apostrophe on any
// field a spreadsheet would run. Every field is text, so a score of -1 is neutralised too.

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export const csvText = (rows: string[][]): string => rows.map((row) => `${row.map(cell).join(",")}\r\n`).join("");
