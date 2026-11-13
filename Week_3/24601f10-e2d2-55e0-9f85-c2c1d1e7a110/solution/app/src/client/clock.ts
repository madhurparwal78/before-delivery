import { useSyncExternalStore } from 'react';

// The browser never trusts its own clock: server time is the last server_time received plus time passed on the page.
let serverMs = 0;
let atPerf = 0;

export function syncServerTime(iso: string): void {
  serverMs = Date.parse(iso);
  atPerf = performance.now();
}

const serverNow = (): number => serverMs + (performance.now() - atPerf);

// One shared one-second tick for every countdown on the page.
let tick = 0;
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  timer ??= setInterval(() => {
    tick += 1;
    subscribers.forEach((s) => s());
  }, 1000);
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useSecondTick(): number {
  return useSyncExternalStore(subscribe, () => tick);
}

export function countdownText(autoConfirmAt: string): string {
  const remaining = Date.parse(autoConfirmAt) - serverNow();
  if (remaining <= 0) return 'Confirming...';
  const seconds = Math.ceil(remaining / 1000);
  return `Auto-confirms in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
