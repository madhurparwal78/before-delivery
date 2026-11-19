import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { navigate } from '../router';

type Loaded<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'missing' } | { state: 'refused'; message: string };

/** Fetch a page's own record. 401 goes to sign-in, 404 becomes `missing`, anything else is shown as a refusal. */
export function useLoad<T>(path: string): { result: Loaded<T>; reload: () => Promise<void> } {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading' });
  const reload = useCallback(async () => {
    try {
      setResult({ state: 'ready', data: await api<T>('GET', path) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) navigate('/sign-in', true);
      else if (error instanceof ApiError && error.status === 404) setResult({ state: 'missing' });
      else setResult({ state: 'refused', message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' });
    }
  }, [path]);
  useEffect(() => {
    setResult({ state: 'loading' });
    void reload();
  }, [reload]);
  return { result, reload };
}
