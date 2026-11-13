// Port time on screen comes from the server's clock: the instant in a reply's Date header, carried
// forward by the page's monotonic clock. The device clock and zone are never read.
import { useEffect, useState } from "react";

let anchor: { server: number; local: number } | null = null;

/** Records the server's instant from a reply's `Date` header. */
export function noteServerTime(headers: Headers): void {
  const date = headers.get("date");
  const server = date ? Date.parse(date) : NaN;
  if (Number.isFinite(server)) anchor = { server, local: performance.now() };
}

/** The server's current instant, or null before any reply has been seen. */
export function serverNow(): number | null {
  return anchor ? anchor.server + (performance.now() - anchor.local) : null;
}

/** Re-renders every `everyMs` and returns the server instant. */
export function useServerNow(everyMs: number): number | null {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
