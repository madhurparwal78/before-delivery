import { useEffect, useRef } from "react";

/** How often screens ask the server for changes; well inside the brief's five-second refresh delay. */
const REFRESH_MS = 2000;

/**
 * Call `load` now and then every REFRESH_MS after each answer, until the screen goes away or `deps` change.
 * Polling, never a held-open stream.
 */
export function usePolling(load: () => Promise<void>, deps: React.DependencyList): void {
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      await latest.current().catch(() => undefined);
      if (!stopped) timer = window.setTimeout(() => void tick(), REFRESH_MS);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, deps);
}
