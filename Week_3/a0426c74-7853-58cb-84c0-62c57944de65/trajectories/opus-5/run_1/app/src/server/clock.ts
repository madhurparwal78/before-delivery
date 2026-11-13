let offsetMs = 0;
const listeners: (() => void)[] = [];

export function now(): number {
  return Date.now() + offsetMs;
}

export function nowIso(): string {
  return new Date(now()).toISOString();
}

export function advanceClock(ms: number): void {
  offsetMs += ms;
  for (const listener of listeners) listener();
}

export function onClockAdvance(listener: () => void): void {
  listeners.push(listener);
}
