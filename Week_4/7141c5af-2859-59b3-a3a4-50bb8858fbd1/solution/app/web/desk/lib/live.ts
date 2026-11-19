import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiFailure } from "./api.ts";

const REFRESH_MS = 5000;

type Refresher = () => Promise<void>;
const refreshers = new Set<Refresher>();
const stateListeners = new Set<(failed: boolean) => void>();

function isRefreshFailure(result: PromiseSettledResult<void>): boolean {
  if (result.status === "fulfilled") return false;
  const reason: unknown = result.reason;
  return !(reason instanceof ApiFailure) || reason.status >= 500;
}

async function tick(): Promise<void> {
  const results = await Promise.allSettled([...refreshers].map((refresher) => refresher()));
  if (results.length === 0) return;
  const failed = results.some(isRefreshFailure);
  for (const listener of stateListeners) listener(failed);
}

export function startRefresh(): void {
  setInterval(() => void tick(), REFRESH_MS);
}

export function onRefreshState(listener: (failed: boolean) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Resolves once what was just set on screen has rendered. */
export function rendered(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

interface Live<Data> {
  data: Data | undefined;
  /** Reads now, and resolves when the answer is on screen. */
  reload: () => Promise<void>;
  /** Puts an answer on screen at once, ahead of any read still in flight. */
  set: (data: Data) => void;
}

/**
 * Data a screen re-reads from the server every 5 seconds, changing only what changed.
 * A read started before a later one's answer, or before a write, never lands over it.
 */
export function useLive<Data>(load: () => Promise<Data>, keys: readonly unknown[]): Live<Data> {
  const [data, setData] = useState<Data | undefined>(undefined);
  const turn = useRef(0);
  const inFlight = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const read = useCallback(async (): Promise<void> => {
    const mine = (turn.current += 1);
    const answer = await loadRef.current();
    if (mine === turn.current) setData(answer);
  }, []);

  useEffect(() => {
    setData(undefined);
    read().catch((error: unknown) => {
      if (error instanceof ApiFailure && error.status === 404) window.location.reload();
    });
    const refresher: Refresher = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await read();
      } finally {
        inFlight.current = false;
      }
    };
    refreshers.add(refresher);
    return () => {
      turn.current += 1;
      refreshers.delete(refresher);
    };
  }, keys);

  const set = useCallback((next: Data) => {
    turn.current += 1;
    setData(next);
  }, []);

  return { data, reload: read, set };
}
