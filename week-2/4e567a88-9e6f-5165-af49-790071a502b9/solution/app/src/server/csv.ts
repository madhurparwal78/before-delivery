// CSV exports: comma separated, quoted where needed, and text a spreadsheet would run as a formula is
// neutralised with a leading quote. Adapted from kit/modules/csv_safe.

type Cell = string | number | bigint | null;

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: Cell): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvText(lines: Cell[][]): string {
  return lines.map((line) => `${line.map(cell).join(",")}\r\n`).join("");
}
