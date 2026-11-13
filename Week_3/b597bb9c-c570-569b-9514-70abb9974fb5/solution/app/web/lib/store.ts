import { useSyncExternalStore } from "react";

/** A tiny observable value: readers re-render when `set` replaces it. */
export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  set(next: T): void {
    this.value = next;
    for (const listener of this.listeners) listener();
  }

  update(change: (current: T) => T): void {
    this.set(change(this.value));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
