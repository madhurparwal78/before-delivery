// SR1 and SR20: a screen's data, re-read every 5 seconds in place. Identical answers change nothing.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

interface Live<T> {
  data: T | null;
  /** The first read failed with this status. */
  failedStatus: number | null;
  /** The last refresh failed, so the refresh line shows. */
  refreshFailed: boolean;
  reload(): Promise<void>;
  /** Puts an answer already in hand into the screen. */
  set(update: (held: T) => T): void;
}

const REFRESH_MS = 5000;

export function useLive<T>(read: () => Promise<T>, onChange?: (before: T, after: T) => void, deps: unknown[] = [], refresh = true): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [failedStatus, setFailedStatus] = useState<number | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const held = useRef<{ json: string; value: T } | null>(null);
  const reading = useRef(false);
  const generation = useRef(0);
  const latestRead = useRef(read);
  const latestChange = useRef(onChange);
  latestRead.current = read;
  latestChange.current = onChange;

  const take = useCallback((value: T) => {
    const json = JSON.stringify(value);
    if (held.current?.json === json) return;
    const before = held.current?.value;
    held.current = { json, value };
    setData(value);
    if (before !== undefined) latestChange.current?.(before, value);
  }, []);

  const pull = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const value = await latestRead.current();
      if (mine !== generation.current) return;
      take(value);
      setRefreshFailed(false);
      setFailedStatus(null);
    } catch (error) {
      if (mine !== generation.current) return;
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401) return;
      if (held.current === null || status === 404 || status === 410) setFailedStatus(status);
      if (status === 0 || status >= 500) setRefreshFailed(true);
    }
  }, [take]);

  useEffect(() => {
    void pull();
    const timer = setInterval(() => {
      if (reading.current || !refresh) return;
      reading.current = true;
      void pull().finally(() => {
        reading.current = false;
      });
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      generation.current += 1;
    };
    // The reader is kept current through a ref; deps name what changes the read itself.
  }, deps);

  const set = useCallback((update: (value: T) => T) => {
    if (!held.current) return;
    generation.current += 1;
    const value = update(held.current.value);
    held.current = { json: JSON.stringify(value), value };
    setData(value);
  }, []);

  return { data, failedStatus, refreshFailed, reload: pull, set };
}
