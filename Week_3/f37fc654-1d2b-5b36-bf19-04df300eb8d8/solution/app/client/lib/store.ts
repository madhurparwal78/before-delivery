// A tiny external store usable from React and from plain modules.
import { useSyncExternalStore } from "react";

interface Store<T> {
  get(): T;
  set(next: Partial<T> | ((current: T) => T)): void;
  use(): T;
}

export function store<T extends object>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    get: () => value,
    set(next) {
      value = typeof next === "function" ? next(value) : { ...value, ...next };
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}
