import { useSyncExternalStore } from 'react';
import type { MeBody } from '../shared/wire';
import { api, ApiError } from './api';

type Known = { state: 'unknown' } | { state: 'signed-out' } | { state: 'signed-in'; me: MeBody };

let known: Known = { state: 'unknown' };
const listeners = new Set<() => void>();

function publish(next: Known): void {
  known = next;
  listeners.forEach((listener) => listener());
}

/** Ask the server who the visitor is (teacher or learner), once per page load or on demand. */
export async function loadMe(): Promise<Known> {
  try {
    publish({ state: 'signed-in', me: await api<MeBody>('GET', '/api/me') });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    publish({ state: 'signed-out' });
  }
  return known;
}

export function setMe(me: MeBody | null): void {
  publish(me ? { state: 'signed-in', me } : { state: 'signed-out' });
}

export function useMe(): Known {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => known,
  );
}
