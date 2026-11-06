/** The only CSV writer: RFC 4180 quoting plus a leading apostrophe on text a spreadsheet would run as a formula. */

const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvText(rows: (string | number | null)[][]): string {
  return rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}
