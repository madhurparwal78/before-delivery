/**
 * The server clock. When APP_CLOCK_CONTROL=1, PUT /api/clock sets the instant and
 * the clock then runs forward in real time from there. Every rule uses this now().
 */
let baseInstant: number | null = null;
let baseWall: number | null = null;

export function now(): Date {
  if (baseInstant !== null && baseWall !== null) {
    return new Date(baseInstant + (Date.now() - baseWall));
  }
  return new Date();
}

export function setNow(instant: Date): void {
  baseInstant = instant.getTime();
  baseWall = Date.now();
}
