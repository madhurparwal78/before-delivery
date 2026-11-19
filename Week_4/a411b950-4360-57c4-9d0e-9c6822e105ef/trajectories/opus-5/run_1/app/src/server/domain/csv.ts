export const CSV_HEADER =
  'reference,received_at,status,name,email,studio,brief,preferred_month,project_slug,fit_score,receipt';

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/** A cell that starts with a formula trigger gets a single quote before its value. */
export function neutraliseCell(value: string): string {
  const first = value.slice(0, 1);
  return FORMULA_TRIGGERS.includes(first) ? `'${value}` : value;
}

function quoteCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function csvRow(cells: readonly string[]): string {
  return cells.map((cell) => quoteCell(neutraliseCell(cell))).join(',');
}
