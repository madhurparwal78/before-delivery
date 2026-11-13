import { useSyncExternalStore } from 'react';
import { versionLive } from '../../shared/messages';
import { api, ApiError, newId } from '../api';
import type { EditorStore } from './store';

/** Publishing is one action at a time for the whole editor, so every Publish control reads `Publishing…` together. */
let pending = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const setPending = (value: boolean): void => {
  pending = value;
  listeners.forEach((listener) => listener());
};

export const usePublishing = (): boolean => useSyncExternalStore(subscribe, () => pending);

/** Publishes (or republishes `fromVersion`) with one Idempotency-Key per click. Resolves with an error text, or null on success. */
export async function publish(store: EditorStore, fromVersion?: number): Promise<string | null> {
  if (pending) return null;
  setPending(true);
  try {
    const { version } = await api.post<{ version: { number: number } }>(
      `/api/projects/${store.getSnapshot().projectId}/versions`,
      fromVersion === undefined ? {} : { fromVersion },
      { 'Idempotency-Key': newId() },
    );
    store.getSnapshot().announce(versionLive(version.number));
    await store.getSnapshot().refresh();
    return null;
  } catch (error) {
    if (error instanceof ApiError) return error.message;
    throw error;
  } finally {
    setPending(false);
  }
}
