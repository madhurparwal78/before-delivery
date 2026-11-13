import { useCallback, useEffect, useRef, useState } from "react";

const REFRESH_MS = 10_000;

const listeners = new Set<() => void>();

/** Asks every live poll to refetch now, after the user's own actions. */
export const refreshNow = (): void => listeners.forEach((listener) => listener());

/**
 * Counts the user's running and finished actions. A refetch is applied only when no action is running and none finished
 * between its request and its answer, so a response to a request sent before an action finished never undoes what that
 * action produced.
 */
let actionsFinished = 0;
let actionsRunning = 0;
export const markActionStarted = (): void => {
  actionsRunning += 1;
};
/** Actions dropped by signing out never answer, so none of them is still running. */
export const forgetRunningActions = (): void => {
  actionsRunning = 0;
};
export const markActionFinished = (): void => {
  actionsRunning -= 1;
  actionsFinished += 1;
};

/** Keeps references of unchanged parts so React skips them and nothing in the page is rebuilt for equal data. */
function reconcile<T>(previous: T, next: T): T {
  if (previous === next) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    const merged = next.map((item: unknown, index: number) => reconcile(previous[index] as unknown, item));
    return (previous.length === merged.length && merged.every((item, index) => item === previous[index]) ? previous : merged) as T;
  }
  if (typeof previous === "object" && previous !== null && typeof next === "object" && next !== null) {
    const before = previous as Record<string, unknown>;
    const after = next as Record<string, unknown>;
    const keys = Object.keys(after);
    const merged: Record<string, unknown> = {};
    for (const key of keys) merged[key] = reconcile(before[key], after[key]);
    const same = keys.length === Object.keys(before).length && keys.every((key) => merged[key] === before[key]);
    return (same ? previous : merged) as T;
  }
  return next;
}

interface Polled<T> {
  data: T | undefined;
  failure: unknown;
  refetch: () => Promise<T | undefined>;
  /** Replaces the held data with a response the caller already has. */
  put: (value: T) => void;
}

/**
 * Fetches on mount, whenever `key` changes, every ten seconds and after the user's own actions, and merges the answer
 * into what is held. A response for an earlier key is thrown away. A null key holds nothing and fetches nothing.
 */
export function usePolled<T>(key: string | null, fetcher: () => Promise<T>): Polled<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [failure, setFailure] = useState<unknown>(null);
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;

  const refetch = useCallback(async (): Promise<T | undefined> => {
    if (keyRef.current === null) return undefined;
    latest.current += 1;
    const mine = latest.current;
    const requestedAfter = actionsFinished;
    try {
      const value: T = await fetcherRef.current();
      if (mine !== latest.current || actionsRunning > 0 || requestedAfter !== actionsFinished) return undefined;
      setData((held) => (held === undefined ? value : reconcile(held, value)));
      setFailure(null);
      return value;
    } catch (error) {
      if (mine === latest.current && actionsRunning === 0 && requestedAfter === actionsFinished) setFailure(error);
      return undefined;
    }
  }, []);

  useEffect(() => {
    setData(undefined);
    setFailure(null);
    if (key === null) return undefined;
    void refetch();
    const timer = setInterval(() => void refetch(), REFRESH_MS);
    listeners.add(refetch as () => void);
    return () => {
      latest.current += 1;
      clearInterval(timer);
      listeners.delete(refetch as () => void);
    };
  }, [key, refetch]);

  const put = useCallback((value: T) => setData((held) => (held === undefined ? value : reconcile(held, value))), []);
  return { data, failure, refetch, put };
}
