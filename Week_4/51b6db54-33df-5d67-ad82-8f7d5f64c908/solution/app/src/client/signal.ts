import { useEffect, useState } from 'preact/hooks';

/** A tiny observable value: components that read it with useSignal re-render when it is set. */
export interface Signal<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function useSignal<T>(source: Signal<T>): T {
  const [, bump] = useState(0);
  useEffect(() => {
    const stop = source.subscribe(() => bump((n) => n + 1));
    bump((n) => n + 1);
    return stop;
  }, [source]);
  return source.get();
}
