import { useCallback, useEffect, useRef, useState } from "react";
import { announce } from "./announce";
import type { ApiFailure, ApiResult } from "./api";

type Loaded<T> = {
  data: T | undefined;
  failure: ApiFailure | undefined;
  loading: boolean;
  reload: () => void;
  patch: (change: (current: T) => T) => void;
};

/** Loads a resource and keeps the last answer on screen while it reloads. */
export function useLoad<T>(load: () => Promise<ApiResult<T>>, deps: readonly unknown[]): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [failure, setFailure] = useState<ApiFailure | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    const request = ++latest.current;
    void loader.current().then((result) => {
      if (request !== latest.current) return;
      if (result.ok) {
        setData(result.data);
        setFailure(undefined);
      } else {
        setFailure(result);
      }
      setLoading(false);
    });
  }, [...deps, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const patch = useCallback((change: (current: T) => T) => setData((current) => (current === undefined ? current : change(current))), []);
  return { data, failure, loading, reload, patch };
}

/** Runs one action at a time: while it is in flight the caller shows Working and status reads Working. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setBusy(true);
    announce("Working");
    try {
      return await work();
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useIsPhone = (): boolean => useMedia("(max-width: 639px)");

/** Runs `callback` 300 ms after the last change to `signature`, measured on the page's own timers. */
export function useDebounce(signature: string, callback: () => void, delay = 300, enabled = true): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => latest.current(), delay);
    return () => window.clearTimeout(timer);
  }, [signature, delay, enabled]);
}

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Candour Bench`;
  }, [title]);
}
