import { useSyncExternalStore } from 'react'

/** A small observable value with one stable snapshot, for state that lives outside any one page. */
export class Store<T> {
  private listeners = new Set<() => void>()
  constructor(private value: T) {}
  get = (): T => this.value
  set(next: T): void {
    this.value = next
    for (const listener of this.listeners) listener()
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get)
}

export const online = new Store<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine)

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => online.set(true))
  window.addEventListener('offline', () => online.set(false))
}

export const OFFLINE_COPY = "You're offline. Changes stay on this device and sync when you reconnect."
