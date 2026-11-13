import { useSyncExternalStore } from "react";

type Announcement = { n: number; text: string };
let current: Announcement = { n: 0, text: "" };
const listeners = new Set<() => void>();

/** Says something in status "Announcements"; every call replaces the node, so a repeated sentence is announced again. */
export function announce(text: string): void {
  current = { n: current.n + 1, text };
  listeners.forEach((listener) => listener());
}

export function Announcements() {
  const message = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return (
    <div role="status" aria-live="polite" aria-atomic="true" aria-label="Announcements" className="sr-only">
      <span key={message.n}>{message.text}</span>
    </div>
  );
}
