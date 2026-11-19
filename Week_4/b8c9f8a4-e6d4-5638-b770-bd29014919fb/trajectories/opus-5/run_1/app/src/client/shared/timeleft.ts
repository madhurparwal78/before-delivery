import { formatTimeLeft } from '../../shared/format';

interface Countdown {
  node: HTMLElement;
  serverSeconds: number;
  pageTimeAtReply: number;
  reachedZero: boolean;
}

const countdowns = new Set<Countdown>();
const zeroListeners = new Set<() => void>();
let ticking = false;

const secondsNow = (countdown: Countdown): number =>
  Math.max(0, countdown.serverSeconds - (performance.now() - countdown.pageTimeAtReply) / 1000);

const tick = (): void => {
  for (const countdown of [...countdowns]) {
    if (!countdown.node.isConnected) {
      countdowns.delete(countdown);
      continue;
    }
    const seconds = secondsNow(countdown);
    countdown.node.textContent = formatTimeLeft(seconds);
    if (seconds <= 0 && !countdown.reachedZero) {
      countdown.reachedZero = true;
      for (const listener of zeroListeners) listener();
    }
  }
};

const startTicking = (): void => {
  if (ticking) return;
  ticking = true;
  window.setInterval(tick, 1000);
};

/**
 * Shows `<time left>` from the server's seconds alone. A browser countdown runs only
 * from `secondsRemaining` and elapsed page time, and never decides status.
 */
export const bindTimeLeft = (node: HTMLElement, serverSeconds: number): void => {
  for (const existing of countdowns) {
    if (existing.node === node) countdowns.delete(existing);
  }
  const countdown: Countdown = {
    node,
    serverSeconds,
    pageTimeAtReply: performance.now(),
    reachedZero: serverSeconds <= 0,
  };
  countdowns.add(countdown);
  node.textContent = formatTimeLeft(serverSeconds);
  startTicking();
};

/** The page fetches again when a countdown reaches zero. */
export const onCountdownZero = (listener: () => void): void => {
  zeroListeners.add(listener);
};
