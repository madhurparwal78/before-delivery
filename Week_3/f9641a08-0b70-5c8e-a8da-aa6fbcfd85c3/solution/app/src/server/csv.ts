// CSV with formula neutralisation (a leading quote on text a spreadsheet would run) and RFC 4180 quoting.

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value !== "number" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvText(table: unknown[][]): string {
  return table.map((row) => `${row.map(cell).join(",")}\r\n`).join("");
}
