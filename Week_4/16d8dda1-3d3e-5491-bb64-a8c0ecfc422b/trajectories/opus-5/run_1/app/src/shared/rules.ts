/** DP-20: a count's share of the total, as a whole percentage rounded half up. */
export function percentOf(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.floor((count * 100) / total + 0.5);
}

/** DP-03: seat ids sort by row letter, then by column number as a number. */
export function compareSeatIds(a: string, b: string): number {
  const rowA = a.charCodeAt(0);
  const rowB = b.charCodeAt(0);
  if (rowA !== rowB) return rowA - rowB;
  return Number(a.slice(1)) - Number(b.slice(1));
}

/** DP-03: row 1 is `A`, and a seat id is its row letter with its 1-based column. */
export function seatIdFor(column: number, row: number): string {
  return `${String.fromCharCode(64 + row)}${column + 1}`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
