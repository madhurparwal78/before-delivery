import { useSyncExternalStore } from 'react';

type Region =
  | 'Inbox announcements'
  | 'Game server'
  | 'Verdicts'
  | 'Team announcements'
  | 'Sign-in announcements'
  | 'Widget announcements';

const texts = new Map<Region, string>();
const listeners = new Set<() => void>();

export function announce(region: Region, text: string): void {
  texts.set(region, text);
  for (const listener of listeners) listener();
}

export function useAnnouncement(region: Region): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => texts.get(region) ?? '',
  );
}

export function resolvePending(region: Region, pending: string): void {
  if (texts.get(region) === pending) announce(region, '');
}
