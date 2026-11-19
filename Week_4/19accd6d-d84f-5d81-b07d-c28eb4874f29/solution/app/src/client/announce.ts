import { createStore } from "./store";

interface Announcement {
  id: number;
  text: string;
}

const KEPT = 6;
let counter = 0;

/** The messages the polite live region holds; each one is its own node so a repeat is announced again. */
export const announcements = createStore<Announcement[]>([]);

export function announce(text: string): void {
  announcements.set((previous) => [...previous, { id: ++counter, text }].slice(-KEPT));
}
