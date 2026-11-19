import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveEvent } from '../../../shared/domain';
import { ApiError, get } from './api';
import { useLive } from './live';

interface Resource<T> {
  data: T | undefined;
  error: ApiError | undefined;
  reload: () => void;
  set: (update: (current: T) => T) => void;
}

/**
 * Loads `path` and reloads it when the live feed names one of `kinds`. Each load carries a sequence number, so an
 * answer for an older path or an older load is dropped. `path` null means nothing to load yet.
 */
export function useResource<T>(path: string | null, kinds: readonly LiveEvent['t'][] = []): Resource<T> {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: ApiError }>({ path });
  const sequence = useRef(0);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(() => {
    const target = current.current;
    if (target === null) return;
    const mine = ++sequence.current;
    get<T>(target).then(
      (data) => {
        if (mine === sequence.current) setState({ path: target, data });
      },
      (error: unknown) => {
        if (mine === sequence.current && error instanceof ApiError) setState({ path: target, error });
      },
    );
  }, []);

  useEffect(() => {
    sequence.current++;
    setState((s) => (s.path === path ? s : { path }));
    load();
  }, [path, load]);

  useLive(kinds, load);

  const set = useCallback((update: (value: T) => T) => {
    setState((s) => (s.data === undefined ? s : { ...s, data: update(s.data) }));
  }, []);

  const fresh = state.path === path;
  return { data: fresh ? state.data : undefined, error: fresh ? state.error : undefined, reload: load, set };
}
