import { useSyncExternalStore } from 'react';

let message = '';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Says a sentence in the visually hidden `status "Drawing announcements"`. */
export function announce(text: string): void {
  message = text;
  for (const listener of listeners) listener();
}

/** The `status "Drawing announcements"` live region. Mount once at the app root. */
export function Announcer() {
  const text = useSyncExternalStore(subscribe, () => message);
  return <div className="visually-hidden" role="status" aria-label="Drawing announcements" aria-live="polite">{text}</div>;
}
