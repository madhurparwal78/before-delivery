import { useSyncExternalStore } from 'react';
import { whenSettled } from './api';

/**
 * The Announcements region: one child per message, oldest first, every message of the page session kept.
 * Messages are plain text; an earlier child is never rewritten.
 */
interface Message {
  id: number;
  text: string;
}

let messages: Message[] = [];
let counter = 0;
const subscribers = new Set<() => void>();

export function announce(text: string): void {
  messages = [...messages, { id: ++counter, text }];
  subscribers.forEach((s) => s());
}

/** An announcement the server started (overdue, low stock): it waits for this window's own action to be announced first. */
export function announceFromServer(text: string): void {
  whenSettled(() => announce(text));
}

const subscribe = (listener: () => void) => {
  subscribers.add(listener);
  return () => void subscribers.delete(listener);
};

export function Announcements() {
  const list = useSyncExternalStore(subscribe, () => messages);
  return (
    <div role="status" aria-label="Announcements" aria-live="polite" className="sr-only">
      {list.map((m) => (
        <p key={m.id}>{m.text}</p>
      ))}
    </div>
  );
}
