/** CSV cells with formula neutralisation (adapted from the kit's csv_safe module). */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value !== "number" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvText(rows: unknown[][]): string {
  return rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}
