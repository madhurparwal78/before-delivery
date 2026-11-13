import { useSyncExternalStore } from 'react';

export type RegionName = 'save' | 'collaboration' | 'notices' | 'upload';

type Messages = Record<RegionName, string>;

let messages: Messages = { save: '', collaboration: '', notices: '', upload: '' };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** A newer message replaces the old one and stays until the next action. */
export function announce(region: RegionName, message: string): void {
  if (messages[region] === message) return;
  messages = { ...messages, [region]: message };
  emit();
}

export function useRegion(region: RegionName): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => messages[region],
  );
}
