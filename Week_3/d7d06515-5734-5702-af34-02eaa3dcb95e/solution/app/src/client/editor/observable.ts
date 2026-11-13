// A tiny external store: React reads it with useSyncExternalStore, plain code reads and writes it directly.
import { useSyncExternalStore } from 'react';

export class Observable<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly get = (): T => this.value;

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }

  update(patch: Partial<T>): void {
    this.set({ ...this.value, ...patch });
  }
}

export function useObservable<T>(store: Observable<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
