// Shared hooks: polling the server, the one breakpoint, reduced motion and loading a resource.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api, type ApiFailure } from "./api";

export const WIDE_QUERY = "(min-width: 1120px)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** The one motion system: one easing, three durations (feedback, state change, travel). */
export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
export const FEEDBACK_MS = 160;
export const STATE_MS = 320;
export const TRAVEL_MS = 640;

export function reducedMotion(): boolean {
  return matchMedia(REDUCED_QUERY).matches;
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener("change", update);
    update();
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useWide = (): boolean => useMedia(WIDE_QUERY);

/** Calls `work` every `everyMs` (at most 5 seconds apart), one call at a time, until the screen goes away. */
export function usePoll(work: () => Promise<unknown>, everyMs: number, active = true): void {
  const latest = useRef(work);
  latest.current = work;
  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(async () => {
        if (stopped) return;
        await latest.current();
        if (!stopped) loop();
      }, everyMs);
    };
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [everyMs, active]);
}

type Loaded<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "failed"; error: ApiFailure; status: number };

/** GETs a resource; `reload` refetches quietly (polls and refreshes never touch the action message). */
export function useResource<T>(path: string | null): [Loaded<T>, (quiet?: boolean) => Promise<T | null>] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const seq = useRef(0);
  const reload = useCallback(async (quiet = true): Promise<T | null> => {
    if (!path) return null;
    const mine = ++seq.current;
    const result = await api<T>("GET", path, { quiet });
    if (mine !== seq.current) return null;
    setLoaded(result.ok ? { state: "ready", data: result.data } : { state: "failed", error: result.error, status: result.status });
    return result.ok ? result.data : null;
  }, [path]);
  useEffect(() => {
    setLoaded({ state: "loading" });
    void reload(false);
  }, [reload]);
  return [loaded, reload];
}
