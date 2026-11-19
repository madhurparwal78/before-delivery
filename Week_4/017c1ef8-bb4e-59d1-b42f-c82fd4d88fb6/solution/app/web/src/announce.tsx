import { useSyncExternalStore } from 'react';

const REGIONS = [
  'Network announcements',
  'Feed announcements',
  'Messaging announcements',
  'Jobs announcements',
  'Profile announcements',
] as const;

type Region = (typeof REGIONS)[number];

const texts = new Map<Region, string>(REGIONS.map((region) => [region, '']));
const flips = new Map<Region, boolean>();
const listeners = new Set<() => void>();
let version = 0;

/** Speaks a polite announcement. A repeat of the same text is spoken again (a zero-width mark flips on each call). */
export function announce(region: Region, text: string): void {
  const flip = !(flips.get(region) ?? false);
  flips.set(region, flip);
  texts.set(region, flip ? text : `${text}​`);
  version += 1;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The five polite live regions, mounted once by the layout. */
export function AnnouncementRegions() {
  useSyncExternalStore(subscribe, () => version);
  return (
    <>
      {REGIONS.map((region) => (
        <div key={region} role="status" aria-live="polite" aria-label={region} className="sr-only">
          {texts.get(region)}
        </div>
      ))}
    </>
  );
}
