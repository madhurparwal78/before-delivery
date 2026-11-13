import { useEffect, useRef, useState } from "react";

/** Seconds as `m:ss`, or `h:mm:ss` from an hour up. */
export function formatRemaining(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

const MEMORY = 40;
const firstSeen = new Map<string, number>();

/** Server clock minus this browser's clock, fixed when a `server_time` reading is first seen so later renders and remounts agree. */
function clockOffset(serverTime: string): number {
  let seen = firstSeen.get(serverTime);
  if (seen === undefined) {
    seen = Date.now();
    firstSeen.set(serverTime, seen);
    if (firstSeen.size > MEMORY) firstSeen.delete(firstSeen.keys().next().value as string);
  }
  return Date.parse(serverTime) - seen;
}

/** Milliseconds left until `endsAt` on the server's clock; it keeps counting through rerenders and repaints of the quote. */
export function useCountdown(endsAt: string, serverTime: string, onEnd?: () => void): number {
  const [, tick] = useState(0);
  const finished = useRef(onEnd);
  finished.current = onEnd;
  const remaining = Date.parse(endsAt) - (Date.now() + clockOffset(serverTime));

  useEffect(() => {
    const timer = window.setInterval(() => tick((count) => count + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const ended = remaining <= 0;
  useEffect(() => {
    if (ended) finished.current?.();
  }, [ended]);

  return remaining;
}
