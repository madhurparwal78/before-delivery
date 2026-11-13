import { useLayoutEffect, useState } from 'preact/hooks';
import { get } from './api.js';

type Loaded<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed' };

/** Fetches `path` once per path; a failed answer reads as not found. The second value replaces the loaded data. */
export const useLoad = <T,>(path: string): [Loaded<T>, (data: T) => void] => {
  const [result, setResult] = useState<Loaded<T>>({ status: 'loading' });
  useLayoutEffect(() => {
    let current = true;
    get<T>(path).then(
      (data) => { if (current) setResult({ status: 'ready', data }); },
      () => { if (current) setResult({ status: 'failed' }); },
    );
    return () => { current = false; };
  }, [path]);
  return [result, (data) => setResult({ status: 'ready', data })];
};
