// Money is integer cents end to end; this only writes it out (brief: API, Format).

/** 4500 → "45.00". */
export function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
