// The hub clock. It starts at real time and, once moved through the
// simulation API, keeps running from the moved instant until restart.
let movedTo: number | null = null;
let movedAt: number | null = null;

export function hubNow(): number {
  if (movedTo === null || movedAt === null) return Date.now();
  return movedTo + (Date.now() - movedAt);
}

/** Move the hub clock; the clock keeps running in real time from here. */
export function moveClock(to: number): void {
  movedAt = Date.now();
  movedTo = to;
}

export function isReal(): boolean {
  return movedTo === null;
}
