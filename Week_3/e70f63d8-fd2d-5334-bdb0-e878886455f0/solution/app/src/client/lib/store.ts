import { useLayoutEffect, useState } from 'preact/hooks';

interface Store<T> {
  get: () => T;
  set: (value: T) => void;
  use: () => T;
}

/** A value shared between components; setting it re-renders every component that uses it. */
export const createStore = <T,>(initial: T): Store<T> => {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      for (const listener of listeners) listener();
    },
    use: () => {
      const [, rerender] = useState(0);
      useLayoutEffect(() => {
        const listener = (): void => rerender((count) => count + 1);
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      }, []);
      return value;
    },
  };
};
