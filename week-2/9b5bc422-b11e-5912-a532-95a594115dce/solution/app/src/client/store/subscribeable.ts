import { useSyncExternalStore } from "react";

type Subscribeable<T> = {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
  use: () => T;
};

/** A value React can read and other modules can watch. */
export function subscribeable<T>(initial: T): Subscribeable<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const get = (): T => value;
  return {
    get,
    subscribe,
    set: (next) => {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    use: () => useSyncExternalStore(subscribe, get),
  };
}
