// The server clock: real time, or SALTREACH_CLOCK_START advancing in real time from process start.
import { performance } from 'node:perf_hooks';
import { config } from './config';

const origin = config.clockStart ?? Date.now();
const startedAt = performance.now();

/** Milliseconds since the epoch on the server clock. Every server time rule reads this. */
export function now(): number {
  return origin + Math.floor(performance.now() - startedAt);
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}
