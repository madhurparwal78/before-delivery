import { subscribeable } from "./subscribeable.ts";

const STAY_MS = 1000;
const CONFIRMATION_MS = 3000;

const queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export const announcement = subscribeable("");
export const confirmation = subscribeable("");

function showNext(): void {
  const next = queue.shift();
  if (next === undefined) {
    timer = null;
    return;
  }
  announcement.set(next);
  timer = setTimeout(showNext, STAY_MS);
}

/** Queues a message for the Announcements region; each stays at least a second. */
export function announce(message: string): void {
  queue.push(message);
  if (timer === null) showNext();
}

let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

/** Announces a sentence and also shows it, for actions that otherwise leave nothing on screen. */
export function showConfirmation(message: string): void {
  announce(message);
  confirmation.set(message);
  if (confirmationTimer !== null) clearTimeout(confirmationTimer);
  confirmationTimer = setTimeout(() => confirmation.set(""), CONFIRMATION_MS);
}
