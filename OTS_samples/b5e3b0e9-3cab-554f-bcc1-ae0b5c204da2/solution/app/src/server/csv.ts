const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: text a spreadsheet would run gets a leading quote, numbers pass through, RFC 4180 quoting. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value !== "number" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CRLF-terminated CSV lines. */
export const csvText = (rows: unknown[][]): string => rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
