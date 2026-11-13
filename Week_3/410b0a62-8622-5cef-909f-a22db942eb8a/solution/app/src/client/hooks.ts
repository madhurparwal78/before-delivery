import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure } from './api.js';
import { useLive } from './live.js';

interface Loaded<T> {
  data: T | null;
  /** The failure of the latest load, when there is no data to show. */
  error: ApiFailure | null;
  reload: () => void;
}

/**
 * Loads data, keeps showing the previous value while a reload runs, and reloads in place whenever a live
 * change concerns one of the athletes (all changes when `athletes` is null).
 */
export function useLoaded<T>(fetcher: () => Promise<T>, deps: readonly unknown[], athletes: readonly string[] | null = null): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiFailure | null }>({ data: null, error: null });
  const latest = useRef(0);
  const running = useRef(false);
  const dirty = useRef(false);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const run = useCallback(async () => {
    if (running.current) {
      dirty.current = true;
      return;
    }
    running.current = true;
    do {
      dirty.current = false;
      const ticket = ++latest.current;
      try {
        const data = await fetchRef.current();
        if (ticket === latest.current) setState({ data, error: null });
      } catch (error) {
        if (ticket === latest.current) setState({ data: null, error: error instanceof ApiFailure ? error : new ApiFailure(0, null) });
      }
    } while (dirty.current);
    running.current = false;
  }, []);

  useEffect(() => {
    void run();
  }, deps);

  const { subscribe } = useLive();
  const watched = useRef(athletes);
  watched.current = athletes;
  useEffect(
    () =>
      subscribe((change) => {
        if (change === null || watched.current === null || watched.current.includes(change.athlete_id)) void run();
      }),
    [subscribe, run]
  );

  return { data: state.data, error: state.error, reload: () => void run() };
}

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export interface Announcer {
  text: string;
  seq: number;
  say: (text: string) => void;
}

/** A message for a live region; saying the same text again replaces the node so it is announced again. */
export function useAnnouncer(): Announcer {
  const [state, setState] = useState({ text: '', seq: 0 });
  const say = useCallback((text: string) => setState((current) => ({ text, seq: current.seq + 1 })), []);
  return { text: state.text, seq: state.seq, say };
}

/** The chart animation length the server publishes in the page head. */
export function chartAnimationMs(): number {
  return Number(document.querySelector('meta[name="chart-duration"]')?.getAttribute('content') ?? 0);
}
