import { useLayoutEffect, useState } from "preact/hooks";

/** A value many components read; setting it re-renders every subscriber. */
export class Store<T> {
  private readonly listeners = new Set<() => void>();

  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(next: T): void {
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useStore<T>(store: Store<T>): T {
  const [, rerender] = useState(0);
  useLayoutEffect(() => store.subscribe(() => rerender((n) => n + 1)), [store]);
  return store.get();
}
