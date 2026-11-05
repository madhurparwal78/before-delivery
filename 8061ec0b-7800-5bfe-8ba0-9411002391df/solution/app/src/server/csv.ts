// CSV export (adapted from kit/modules/csv_safe): formula neutralisation, then standard quoting.

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell: text starting with = + - @ tab or CR gets a leading apostrophe; numbers pass through unchanged. */
function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value !== "number" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CRLF-terminated lines. */
export function csvText(rows: readonly (readonly (string | number)[])[]): string {
  return rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}
