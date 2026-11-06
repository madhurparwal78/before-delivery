/**
 * The seat-order rule: row letter, then seat number, everywhere.
 */
export const seatOrderSql = `ORDER BY substring(seat from 1 for 1), substring(seat from 2)::int`;

export function seatSort(seats: string[]): string[] {
  return [...seats].sort((a, b) => {
    const rowA = a.charCodeAt(0);
    const rowB = b.charCodeAt(0);
    if (rowA !== rowB) return rowA - rowB;
    return Number(a.slice(1)) - Number(b.slice(1));
  });
}
