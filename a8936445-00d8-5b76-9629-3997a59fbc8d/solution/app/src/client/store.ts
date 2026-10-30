// A tiny observable store and the hooks screens use to follow it.
import { useEffect, useReducer, useState } from "preact/hooks";

export class Store<S> {
  private readonly listeners = new Set<() => void>();

  constructor(private state: S) {}

  get(): S {
    return this.state;
  }

  set(next: S): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  update(change: (current: S) => S): void {
    this.set(change(this.state));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useStore<S>(store: Store<S>): S {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => store.subscribe(() => rerender(undefined)), [store]);
  return store.get();
}

const reducedQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

export function prefersReducedMotion(): boolean {
  return reducedQuery?.matches ?? false;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion());
  useEffect(() => {
    if (!reducedQuery) return;
    const listener = (): void => setReduced(reducedQuery.matches);
    reducedQuery.addEventListener("change", listener);
    return () => reducedQuery.removeEventListener("change", listener);
  }, []);
  return reduced;
}
