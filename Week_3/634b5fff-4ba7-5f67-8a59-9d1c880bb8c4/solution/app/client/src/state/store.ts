import { useSyncExternalStore } from "react";

/** A value that React components can subscribe to; the stores of the page are instances of it. */
export class Store<T> {
  private readonly listeners = new Set<() => void>();

  constructor(private value: T) {}

  readonly get = (): T => this.value;

  readonly set = (next: T): void => {
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  };

  readonly update = (change: (current: T) => T): void => {
    this.set(change(this.value));
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const useStore = <T>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get);

