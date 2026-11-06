// The hub clock: the server's clock, moved only through the simulation API, running in real time.
// A move lasts until the server restarts.

let offsetMs = 0;

export function hubNow(): number {
  return Date.now() + offsetMs;
}

export function setHubClock(instant: number): void {
  offsetMs = instant - Date.now();
}
