import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";
import { onLive } from "./live";
import type { LiveEvent } from "./types";

/** Preact defers useEffect to animation frames, which a paused page clock never delivers. */
export const useMount = useLayoutEffect;

export function useLive(handler: (event: LiveEvent) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useLayoutEffect(() => onLive((event) => latest.current(event)), []);
}

interface Resource<T> {
  data: T | undefined;
  failed: boolean;
  reload: () => void;
  set: (value: T) => void;
}

/**
 * Loads data now and again whenever `relevant` says a live event touches it. Reloads that arrive
 * while a load is running coalesce into one more load; the screen never blanks while reloading.
 */
export function useResource<T>(load: () => Promise<T | undefined>, deps: unknown[], relevant: (event: LiveEvent) => boolean): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // `changes` counts local sets: a load that started before one would paint the older state, so it is dropped and run again.
  const state = useRef({ running: false, dirty: false, alive: true, changes: 0, load });
  state.current.load = load;

  const run = useCallback(async () => {
    const s = state.current;
    if (s.running) {
      s.dirty = true;
      return;
    }
    s.running = true;
    do {
      s.dirty = false;
      const changes = s.changes;
      try {
        const value = await s.load();
        if (s.changes !== changes) s.dirty = true;
        else if (s.alive && value !== undefined) {
          setData(value);
          setFailed(false);
        } else if (s.alive) setFailed(true);
      } catch {
        if (s.alive) setFailed(true);
      }
    } while (s.dirty);
    s.running = false;
  }, []);

  useLayoutEffect(() => {
    state.current.alive = true;
    setData(undefined);
    setFailed(false);
    void run();
    return () => {
      state.current.alive = false;
    };
  }, deps);

  useLive((event) => {
    if (event.t === "resync" || relevant(event)) void run();
  });
  const set = (value: T) => {
    state.current.changes += 1;
    setData(value);
  };
  return { data, failed, reload: () => void run(), set };
}
