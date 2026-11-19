/** Seat ids sort by row letter, then by column number as a number (B9 before B10). */
export function compareSeatIds(a: string, b: string): number {
  return a.charCodeAt(0) - b.charCodeAt(0) || Number(a.slice(1)) - Number(b.slice(1));
}
