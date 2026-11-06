let bootReal = Date.now();
let bootFake = Date.now();
let shifted = false;

export function initClock(startIso: string | null): void {
  if (!startIso) return;
  const t = Date.parse(startIso);
  if (Number.isNaN(t)) return;
  bootReal = Date.now();
  bootFake = t;
  shifted = true;
}

/** The server's now: Date.now(), or the shifted clock when SERVER_CLOCK_START is set. */
export function nowMs(): number {
  if (!shifted) return Date.now();
  return bootFake + (Date.now() - bootReal);
}
