// CSV formula neutralisation plus RFC 4180 quoting (adapted from kit/modules/csv_safe).

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | null): string {
  if (value === null) return "";
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Lines end with CRLF, the last one included. */
export const csvText = (rows: (string | null)[][]): string =>
  rows.map((row) => `${row.map(cell).join(",")}\r\n`).join("");
