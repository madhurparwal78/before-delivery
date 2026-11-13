export const MOVES_EXPORT_HEADER = [
  'ref',
  'vessel',
  'agency',
  'status',
  'boarding_at',
  'pinch_waypoint',
  'margin_mm',
  'tariff_revision',
  'total_cents',
] as const;

const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r'];

/** A text cell that could run as a formula gets one single quote put in front of it. */
export function csvTextCell(value: string): string {
  const guarded = FORMULA_STARTS.some((start) => value.startsWith(start)) ? `'${value}` : value;
  return quoteIfNeeded(guarded);
}

export function csvIntegerCell(value: number): string {
  return String(value);
}

function quoteIfNeeded(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function csvDocument(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join(',')).join('\r\n') + '\r\n';
}
