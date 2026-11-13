// status "Announcements": every success, failure and outage message goes here (brief: Announcement rule).
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';

interface Message { text: string; n: number }

let current: Message = { text: '', n: 0 };
const listeners = new Set<() => void>();

export function announce(text: string): void {
  current = { text, n: current.n + 1 };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lives outside the app root so modal dialogs (which make the root inert) can still announce. */
export function Announcements() {
  const message = useSyncExternalStore(subscribe, () => current);
  return createPortal(
    <div role="status" aria-label="Announcements" aria-live="polite" className="sr-only">
      <span key={message.n}>{message.text}</span>
    </div>,
    document.body,
  );
}
