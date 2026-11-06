// The kitchen clock on screen is the server's: every response carrying `server_now` re-syncs it,
// and between responses it advances only by elapsed time measured here (never the device's date).

import { useEffect, useState } from "react";

let synced: { serverMs: number; elapsedAt: number } | null = null;

export function syncServerClock(serverNow: string): void {
  synced = { serverMs: Date.parse(serverNow), elapsedAt: performance.now() };
}

/** The server's current instant, or null before the first response. */
export function serverNow(): number | null {
  return synced ? synced.serverMs + (performance.now() - synced.elapsedAt) : null;
}

/** Re-renders every `everyMs` and returns the server's current instant. */
export function useServerNow(everyMs: number): number | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return serverNow();
}
