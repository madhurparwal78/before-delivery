import { useSyncExternalStore } from "react";

/** A small observable value; components read slices of it with `useStore`. */
export function createStore<State>(initial: State) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: (): State => state,
    set: (next: State | ((previous: State) => State)): void => {
      state = typeof next === "function" ? (next as (previous: State) => State)(state) : next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type Store<State> = ReturnType<typeof createStore<State>>;

export function useStore<State, Slice>(store: Store<State>, select: (state: State) => Slice): Slice {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
