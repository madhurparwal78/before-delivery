import { useEffect, useState } from "preact/hooks";

/** A minimal observable store: components read slices of it, plain modules read and write it. */
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}
  get = (): T => this.state;
  set(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useStore<T extends object, S>(store: Store<T>, select: (state: T) => S): S {
  const [value, setValue] = useState<S>(() => select(store.get()));
  useEffect(() => {
    const update = (): void => setValue(() => select(store.get()));
    update();
    return store.subscribe(update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return value;
}
