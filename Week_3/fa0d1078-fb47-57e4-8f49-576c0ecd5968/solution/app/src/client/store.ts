import { useLayoutEffect, useState } from "preact/hooks";

/** A value that components can read and subscribe to. */
export class Store<Value> {
  private listeners = new Set<() => void>();

  constructor(private value: Value) {}

  get(): Value {
    return this.value;
  }

  set(value: Value): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useStore<Value>(store: Store<Value>): Value {
  const [value, setValue] = useState(store.get());
  useLayoutEffect(() => {
    setValue(store.get());
    return store.subscribe(() => setValue(store.get()));
  }, [store]);
  return value;
}
