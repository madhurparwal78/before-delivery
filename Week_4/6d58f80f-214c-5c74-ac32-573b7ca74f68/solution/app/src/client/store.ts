// Small observable stores shared by the screens, read with `useStore`.
import { useSyncExternalStore } from "react";

export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}

  get = (): T => this.value;

  set(next: T | ((current: T) => T)): void {
    const value = typeof next === "function" ? (next as (current: T) => T)(this.value) : next;
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** A tiny event bus for pushed changes. */
export class Bus<E extends Record<string, unknown>> {
  private handlers = new Map<keyof E, Set<(data: never) => void>>();

  on<K extends keyof E>(kind: K, handler: (data: E[K]) => void): () => void {
    let set = this.handlers.get(kind);
    if (!set) this.handlers.set(kind, set = new Set());
    set.add(handler as (data: never) => void);
    return () => set.delete(handler as (data: never) => void);
  }

  emit<K extends keyof E>(kind: K, data: E[K]): void {
    for (const handler of this.handlers.get(kind) ?? []) (handler as (data: E[K]) => void)(data);
  }
}
