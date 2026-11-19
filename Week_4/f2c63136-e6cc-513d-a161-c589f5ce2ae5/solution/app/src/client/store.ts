import { useLayoutEffect, useState } from 'preact/hooks';
import type { ComponentChild } from 'preact';

// Page timers are paused in the test browsers, so nothing here uses useEffect or timers:
// state changes come from events and promises only.

interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useLayoutEffect(() => {
    setValue(store.get());
    return store.subscribe(() => setValue(store.get()));
  }, [store]);
  return value;
}

/** The service outage strip: a refusal or outage with its verbatim copy, optionally with a control. */
export const announcement = createStore<{ message: string; action?: ComponentChild } | null>(null);

/** The result of the user's own action (`status "Action status"`). */
export const actionStatus = createStore<string>('');

export const session = createStore<{ username: string; name: string } | null>(null);
