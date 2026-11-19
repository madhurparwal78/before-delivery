export type Life = {
  alive: () => boolean;
  kill: () => void;
  every: (millis: number, work: () => void) => void;
  after: (millis: number, work: () => void) => number;
  listen: <K extends keyof WindowEventMap>(
    target: EventTarget,
    type: K | string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ) => void;
};

/**
 * Ties timers, listeners and pending answers to one screen, so leaving it (or signing out)
 * stops every one of them and discards whatever is still in flight.
 */
export function makeLife(): Life {
  let living = true;
  const timers: number[] = [];
  const intervals: number[] = [];
  const listeners: { target: EventTarget; type: string; handler: EventListener }[] = [];

  return {
    alive: () => living,
    kill: () => {
      living = false;
      for (const timer of timers) window.clearTimeout(timer);
      for (const interval of intervals) window.clearInterval(interval);
      for (const entry of listeners) {
        entry.target.removeEventListener(entry.type, entry.handler);
      }
      timers.length = 0;
      intervals.length = 0;
      listeners.length = 0;
    },
    every: (millis, work) => {
      intervals.push(
        window.setInterval(() => {
          if (living) work();
        }, millis),
      );
    },
    after: (millis, work) => {
      const timer = window.setTimeout(() => {
        if (living) work();
      }, millis);
      timers.push(timer);
      return timer;
    },
    listen: (target, type, handler, options) => {
      const wrapped: EventListener = (event) => {
        if (living) handler(event);
      };
      target.addEventListener(type as string, wrapped, options);
      listeners.push({ target, type: type as string, handler: wrapped });
    },
  };
}
