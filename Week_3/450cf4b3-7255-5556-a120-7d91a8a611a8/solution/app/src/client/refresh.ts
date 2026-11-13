// The one refresh mechanism: every screen that re-reads on a timer uses this hook. A failed or
// superseded read changes nothing: the latest run wins.

import { useEffect, useRef } from "preact/hooks";

/** How often an open screen re-reads its data (the brief: every 10 seconds). */
export const REFRESH_MS = 10_000;

/**
 * Runs `load` now and then every `everyMs` while mounted, and again whenever `deps` change. `load`
 * receives `current()`, false once a newer run began or the screen left, so a late answer can be dropped.
 */
export function useRefresh(load: (current: () => boolean) => Promise<void>, everyMs: number, deps: readonly unknown[] = []): () => Promise<void> {
  const latest = useRef(load);
  latest.current = load;
  const serial = useRef(0);
  const run = useRef((): Promise<void> => {
    const mine = ++serial.current;
    return latest.current(() => mine === serial.current);
  });
  useEffect(() => {
    void run.current();
    const timer = window.setInterval(() => void run.current(), everyMs);
    return () => {
      window.clearInterval(timer);
      serial.current++;
    };
  }, deps);
  return () => run.current();
}
