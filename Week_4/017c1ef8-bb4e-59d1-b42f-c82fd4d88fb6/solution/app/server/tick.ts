import { now } from './clock.js';

type Tick = (previous: Date, current: Date) => void | Promise<void>;

const ticks: Tick[] = [];
let previous = now();

/** Registers a time-based check that runs every second with the span of business time since the last run. */
export function onTick(tick: Tick): void {
  ticks.push(tick);
}

export function startTicks(): void {
  previous = now();
  setInterval(() => {
    const current = now();
    const span = previous;
    previous = current;
    for (const tick of ticks) {
      Promise.resolve(tick(span, current)).catch((error: unknown) => console.error('tick failed', error));
    }
  }, 1000).unref();
}
