import { useEffect, useRef, useState } from "react";

/**
 * Counts down from a server-reported `seconds_left` on the page clock. `anchor` changes whenever the
 * server answered again (its `server_time`), which restarts the count. The server is asked again when
 * the tab becomes visible, every 30 seconds while visible and when the count reaches zero; the device
 * clock never decides anything.
 */
export function useCountdown(seconds: number | null, anchor: string | null, resync: () => void): number | null {
  const [left, setLeft] = useState<number | null>(seconds);
  const latest = useRef(resync);
  latest.current = resync;

  useEffect(() => {
    setLeft(seconds);
  }, [seconds, anchor]);

  const running = seconds !== null;
  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => setLeft((value) => (value === null || value <= 0 ? value : value - 1)), 1000);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") latest.current();
    }, 30_000);
    const visible = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [running]);

  const zero = left === 0;
  useEffect(() => {
    if (zero) latest.current();
  }, [zero]);

  return left;
}
