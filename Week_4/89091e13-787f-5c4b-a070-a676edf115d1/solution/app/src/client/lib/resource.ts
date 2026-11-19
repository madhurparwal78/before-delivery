import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ApiError, getJson } from "./api.ts";

/** Bumped by the live channel; every resource refetches when it changes. */
export const LiveVersionContext = createContext(0);

interface ResourceState<T> {
  key: string | null;
  data: T | null;
  error: ApiError | null;
}

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads `fetcher()` for `key`, refetching whenever the live version changes. Requests never overlap: a refetch asked for
 * while one is running runs once more when it ends.
 */
export function useResource<T>(key: string | null, fetcher: () => Promise<T>, keepPrevious = false): Resource<T> {
  const version = useContext(LiveVersionContext);
  const [state, setState] = useState<ResourceState<T>>({ key: null, data: null, error: null });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  const keyRef = useRef(key);
  const loop = useRef({ running: false, queued: false });
  const mounted = useRef(true);
  fetcherRef.current = fetcher;
  keyRef.current = key;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (loop.current.running) {
      loop.current.queued = true;
      return;
    }
    loop.current.running = true;
    do {
      loop.current.queued = false;
      const asked = keyRef.current;
      if (asked === null) continue;
      try {
        const data = await fetcherRef.current();
        if (mounted.current && asked === keyRef.current) setState({ key: asked, data, error: null });
      } catch (caught) {
        if (!(caught instanceof ApiError)) throw caught;
        if (mounted.current && asked === keyRef.current) setState((old) => ({ key: asked, data: old.key === asked ? old.data : null, error: caught }));
      }
    } while (loop.current.queued);
    loop.current.running = false;
  }, []);

  useEffect(() => {
    void run();
  }, [key, version, tick, run]);

  const current = state.key === key || keepPrevious;
  const data = current ? state.data : null;
  const error = state.key === key ? state.error : null;
  return { data, error, loading: data === null && error === null, reload: () => setTick((n) => n + 1) };
}

export function useJson<T>(path: string | null, keepPrevious = false): Resource<T> {
  return useResource<T>(path, () => getJson<T>(path as string), keepPrevious);
}
