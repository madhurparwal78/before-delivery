// Tiny external store. `createStore(initial)` gives get/set/update/subscribe; `useStore(store)` re-renders a component when
// the value changes. Subscriptions are layout effects so a change made right after render is never missed and nothing waits
// for a timer or animation frame.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

interface Store<T> {
  get(): T;
  set(next: T): void;
  update(change: (current: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  function set(next: T): void {
    if (Object.is(next, value)) return;
    value = next;
    for (const listener of [...listeners]) listener();
  }
  return {
    get: () => value,
    set,
    update: (change) => set(change(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  const [, setTick] = useState(0);
  const rerender = () => setTick((n) => n + 1);
  const rendered = useRef(store.get());
  rendered.current = store.get();
  useLayoutEffect(() => {
    const unsubscribe = store.subscribe(rerender);
    if (!Object.is(rendered.current, store.get())) rerender();
    return unsubscribe;
  }, [store]);
  return store.get();
}
