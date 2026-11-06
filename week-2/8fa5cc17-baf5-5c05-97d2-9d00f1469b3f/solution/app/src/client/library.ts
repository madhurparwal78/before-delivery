// The library rail's data: types in library order, collections and the recent daily notes.
import { useEffect, useSyncExternalStore } from 'react';
import { get } from './api.ts';
import { subscribe } from './sync.ts';
import type { CollectionJson, TypeJson } from './types.ts';

export interface Library { types: TypeJson[]; collections: CollectionJson[]; recent: Array<{ date: string; object_id: string }>; loaded: boolean }

let library: Library = { types: [], collections: [], recent: [], loaded: false };
const listeners = new Set<() => void>();
let started = false;

export async function refreshLibrary(): Promise<void> {
  try {
    const [t, c, r] = await Promise.all([
      get<{ types: TypeJson[] }>('/api/types'),
      get<{ collections: CollectionJson[] }>('/api/collections'),
      get<{ notes: Array<{ date: string; object_id: string }> }>('/api/daily/recent'),
    ]);
    if (t.status !== 200 || c.status !== 200 || r.status !== 200) return;
    library = { types: t.data.types, collections: c.data.collections, recent: r.data.notes, loaded: true };
    for (const fn of listeners) fn();
  } catch {
    // keep the last library while offline
  }
}

export function useLibrary(): Library {
  useEffect(() => {
    if (started) return;
    started = true;
    void refreshLibrary();
    subscribe((event) => {
      if (event === 'object.saved' || event === 'object.removed' || event === 'sync.reset') void refreshLibrary();
    });
  }, []);
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => library);
}
