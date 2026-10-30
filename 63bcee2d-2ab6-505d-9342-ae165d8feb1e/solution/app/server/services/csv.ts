// CSV exports (brief: CSV exports): UTF-8 with a header row, RFC 4180 quoting, and any text cell that a
// spreadsheet would run (starting =, +, -, @, tab or carriage return) written with a leading apostrophe.

const FORMULA_START = /^[=+\-@\t\r]/;

/** A cell the app formats itself (amounts, positions, weights, times), never neutralised. */
class Figure {
  constructor(readonly value: string) {}
}

export const figure = (value: string | number): Figure => new Figure(String(value));
type Cell = string | Figure;

function cell(value: Cell): string {
  let text = value instanceof Figure ? value.value : value;
  if (!(value instanceof Figure) && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The whole file, CRLF line ends. */
export function csvFile(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => `${row.map(cell).join(",")}\r\n`).join("");
}

/** The reply headers of a CSV download. */
export const csvHeaders = (filename: string): Record<string, string> => ({
  "Content-Type": "text/csv; charset=utf-8",
  "Content-Disposition": `attachment; filename="${filename}"`,
});
