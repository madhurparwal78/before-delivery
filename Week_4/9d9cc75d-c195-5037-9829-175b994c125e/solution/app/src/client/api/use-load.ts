import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ApiError, track } from './client.ts';

/** Applies state updates synchronously, so the screen has caught up before the pending counter drops. */
export function commit(update: () => void): void {
  flushSync(update);
}

/**
 * Runs a user action inside the pending counter. Call `commit` for the success updates; an `ApiError` thrown by
 * `work` goes to `fail`, also applied synchronously. Any other error propagates.
 */
export async function act(work: () => Promise<void>, fail: (error: ApiError) => void): Promise<void> {
  await track(async () => {
    try {
      await work();
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      commit(() => fail(caught));
    }
  });
}

interface Loaded<T> {
  data: T | undefined;
  error: ApiError | null;
  /** Fetches again and replaces `data`. */
  reload: () => Promise<void>;
  /** Replaces `data` with a value the page already holds. */
  set: (value: T) => void;
}

/**
 * Loads a page's data when `deps` change. The state lands synchronously (`flushSync`) before the pending counter
 * drops, so requests started by the new screen are counted before the page is seen as settled.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const run = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const fetchNow = useCallback(async () => {
    const mine = ++run.current;
    await track(async () => {
      let value: T | undefined;
      let failure: ApiError | null = null;
      try {
        value = await loader.current();
      } catch (caught) {
        if (!(caught instanceof ApiError)) throw caught;
        failure = caught;
      }
      if (mine !== run.current) return;
      commit(() => {
        if (failure) setError(failure);
        else {
          setData(value);
          setError(null);
        }
      });
    });
  }, []);

  useEffect(() => {
    void fetchNow();
    return () => {
      run.current += 1;
    };
  }, deps);

  return { data, error, reload: fetchNow, set: setData };
}
