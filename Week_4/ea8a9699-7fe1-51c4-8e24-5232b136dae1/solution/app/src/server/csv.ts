// Cluster sheet cells (adapted from kit/modules/csv_safe; brief: API > Cluster sheet). The one place a
// formula-like cell is neutralised.

const FORMULA_START = new Set(["=", "+", "-", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠"]);

/** A title or source-clip cell: neutralised, then quoted. */
export function textCell(value: string): string {
  const first = [...value][0];
  return quoted(first !== undefined && FORMULA_START.has(first) ? `'${value}` : value);
}

/** Any other cell: quoted only. */
export function quoted(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const csvLines = (rows: string[][]): string => rows.map((row) => `${row.join(",")}\r\n`).join("");
