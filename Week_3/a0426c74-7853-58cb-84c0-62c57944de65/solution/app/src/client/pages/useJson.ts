import { useEffect, useState } from 'react';
import { ApiFailure, getJson } from '../api.ts';

export type Loaded<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; failure: ApiFailure };

const LOADING: Loaded<never> = { status: 'loading' };

/** GETs a JSON path on mount, whenever the path changes and whenever `refresh` changes (the last answer stays shown until the new one arrives). */
export function useJson<T>(path: string, refresh = 0): Loaded<T> {
  const [answer, setAnswer] = useState<{ path: string; loaded: Loaded<T> } | null>(null);
  useEffect(() => {
    let current = true;
    getJson<T>(path).then(
      (data) => {
        if (current) setAnswer({ path, loaded: { status: 'ready', data } });
      },
      (failure: unknown) => {
        if (!current) return;
        if (failure instanceof ApiFailure) setAnswer({ path, loaded: { status: 'failed', failure } });
        else throw failure;
      },
    );
    return () => {
      current = false;
    };
  }, [path, refresh]);
  return answer?.path === path ? answer.loaded : LOADING;
}
