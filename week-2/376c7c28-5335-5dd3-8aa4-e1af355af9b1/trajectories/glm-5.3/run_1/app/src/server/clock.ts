// App clock: starts at APP_CLOCK_START when configured, then runs forward in real time.
let epochOffsetMs = 0;
let baseReal = 0;

export function initClock(startIso: string | undefined): void {
  if (startIso === undefined) return;
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return;
  baseReal = Date.now();
  epochOffsetMs = start - baseReal;
}

export function now(): Date {
  return new Date(Date.now() + epochOffsetMs);
}

export function nowMs(): number {
  return Date.now() + epochOffsetMs;
}
