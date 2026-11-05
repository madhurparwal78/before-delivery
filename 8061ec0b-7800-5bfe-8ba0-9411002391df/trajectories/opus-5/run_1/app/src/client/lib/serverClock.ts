let serverMs: number | null = null;
let measuredAt = 0;

/** Keeps the one estimate of the server clock, measured with the browser's elapsed-time counter. */
export function setServerNow(iso: string): void {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return;
  serverMs = parsed;
  measuredAt = performance.now();
}

export function serverNow(): number | null {
  if (serverMs === null) return null;
  return serverMs + (performance.now() - measuredAt);
}

export function hasServerNow(): boolean {
  return serverMs !== null;
}
