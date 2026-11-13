import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, api } from "./api.js";
import { useLive } from "./live.js";

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Resource<T> = { data: T | undefined; error: ApiFailure | undefined; reload: () => void };

/** Loads `path` and loads it again whenever one of the live `topics` changes; the last good data stays while it reloads. */
export function useResource<T>(path: string | null, topics: string[]): Resource<T> {
  const live = useLive();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiFailure>();
  const [manual, setManual] = useState(0);
  const generation = useRef(0);
  const versions = topics.map((topic) => live.topics[topic] ?? 0).join(",");

  useEffect(() => {
    if (path === null) return;
    const mine = ++generation.current;
    api<T>("GET", path)
      .then((value) => {
        if (mine !== generation.current) return;
        setData(value);
        setError(undefined);
      })
      .catch((failure: unknown) => {
        if (mine !== generation.current || !(failure instanceof ApiFailure)) return;
        setError(failure);
      });
  }, [path, versions, manual]);

  const reload = useCallback(() => setManual((count) => count + 1), []);
  return { data, error, reload };
}

/** True while the page's socket is not open: the buttons that change the register stay disabled. */
export function useSocketGate(): boolean {
  return !useLive().open;
}

/** Calls `action` once the value has stopped changing for `delay` ms. */
export function useSettled<T>(value: T, delay: number, action: (value: T) => void): void {
  const latest = useRef(action);
  latest.current = action;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => latest.current(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
}
