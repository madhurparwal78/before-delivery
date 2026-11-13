/** Small shared utilities. */

export function compareAsc(a: Date | number, b: Date | number): number {
  const x = typeof a === "number" ? a : a.getTime();
  const y = typeof b === "number" ? b : b.getTime();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Base-36 cursor encoding for gallery paging. */
export function encodeCursor(n: number): string {
  return n.toString(36);
}

export function decodeCursor(s: string): number | null {
  if (!/^[0-9a-z]+$/.test(s)) return null;
  const n = parseInt(s, 36);
  return Number.isSafeInteger(n) ? n : null;
}
