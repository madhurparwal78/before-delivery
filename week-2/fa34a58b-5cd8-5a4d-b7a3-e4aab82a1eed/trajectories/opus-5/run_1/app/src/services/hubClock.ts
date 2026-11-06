/**
 * The hub clock is the server's clock, moved only through the simulation API.
 * Moves last until the server restarts.
 */

let offsetMs = 0;
const moveListeners: ((previous: Date, next: Date) => void)[] = [];

export function hubNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function onClockMove(listener: (previous: Date, next: Date) => void): void {
  moveListeners.push(listener);
}

export function moveHubClock(to: Date): void {
  const previous = hubNow();
  offsetMs = to.getTime() - Date.now();
  const next = hubNow();
  for (const listener of moveListeners) listener(previous, next);
}
