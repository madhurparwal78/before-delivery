import { useLayoutEffect, useState } from "preact/hooks";

/** One shared value that components can read and follow. */
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

/** Re-renders the component each time the store changes. */
export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useLayoutEffect(() => {
    setValue(store.get());
    return store.subscribe(() => setValue(store.get()));
  }, [store]);
  return value;
}
