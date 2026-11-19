import { useLayoutEffect, useState } from 'preact/hooks';

interface Signal<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

/** A tiny observable value: pages read it with `useSignal` and re-render when it changes. */
export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useSignal<T>(source: Signal<T>): T {
  const [value, setValue] = useState(source.get());
  useLayoutEffect(() => {
    setValue(source.get());
    return source.subscribe(() => setValue(source.get()));
  }, [source]);
  return value;
}
