import { useLayoutEffect, useRef, useState } from "preact/hooks";

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Re-renders the component when the selected slice changes (compared by identity). */
export function useSelect<T extends object, S>(store: Store<T>, select: (state: T) => S): S {
  const [, force] = useState(0);
  const selected = select(store.get());
  const last = useRef(selected);
  const choose = useRef(select);
  last.current = selected;
  choose.current = select;
  useLayoutEffect(() => {
    const check = () => {
      if (!Object.is(choose.current(store.get()), last.current)) force((n) => n + 1);
    };
    check();
    return store.subscribe(check);
  }, [store]);
  return selected;
}

/** A tiny typed event emitter for one-off notifications between modules and screens. */
export function createEmitter<T>() {
  const handlers = new Set<(value: T) => void>();
  return {
    emit(value: T) {
      for (const handler of [...handlers]) handler(value);
    },
    on(handler: (value: T) => void) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
