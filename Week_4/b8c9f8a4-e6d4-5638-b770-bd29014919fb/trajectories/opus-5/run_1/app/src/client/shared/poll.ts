import { onCountdownZero } from './timeleft';

export const POLL_MS = 15_000;

export interface Poller {
  /** Fetches now, outside the timer. */
  now(): void;
  /** Stops polling, for a page that has been replaced. */
  stop(): void;
  /** Marks the sequence of the newest reply the page has applied. */
  readonly sequence: number;
}

/**
 * Fetches every 15 seconds, on regaining focus, and when a countdown reaches zero. A
 * reply asked for before an action's reply arrived, and landing after it, is dropped,
 * so the page never steps back to older state.
 */
export const startPolling = (fetchState: () => Promise<void>): Poller => {
  let stopped = false;
  let inFlight = false;
  let sequence = 0;

  const run = (): void => {
    if (stopped || inFlight) return;
    inFlight = true;
    sequence += 1;
    fetchState()
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  const timer = window.setInterval(run, POLL_MS);
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
  onCountdownZero(run);

  return {
    now: run,
    stop() {
      stopped = true;
      window.clearInterval(timer);
    },
    get sequence() {
      return sequence;
    },
  };
};

/**
 * Keeps the page from stepping back to older state: a reply is applied only when no
 * newer reply has already been applied.
 */
export class ReplyOrder {
  private applied = 0;
  private issued = 0;

  next(): number {
    this.issued += 1;
    return this.issued;
  }

  accept(ticket: number): boolean {
    if (ticket <= this.applied) return false;
    this.applied = ticket;
    return true;
  }
}
