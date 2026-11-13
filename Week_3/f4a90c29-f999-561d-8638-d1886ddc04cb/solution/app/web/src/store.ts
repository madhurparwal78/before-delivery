import { useLayoutEffect, useReducer } from "preact/hooks";

export class Store<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T | ((previous: T) => T)): void {
    this.value = typeof next === "function" ? (next as (p: T) => T)(this.value) : next;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useStore<T>(store: Store<T>): T {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    const stop = store.subscribe(() => rerender(0));
    rerender(0);
    return stop;
  }, [store]);
  return store.get();
}
