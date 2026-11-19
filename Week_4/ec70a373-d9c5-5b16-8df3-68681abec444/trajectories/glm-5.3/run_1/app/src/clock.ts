import { loadEnv, type Env } from './env.js';

let env: Env | null = null;

export function environment(): Env {
  if (env === null) {
    env = loadEnv();
    const start = env.PILOTLIGHT_CLOCK_START;
    bootEpoch = start ? start.getTime() : Date.now();
    bootWallMs = Date.now();
  }
  return env;
}

let bootEpoch = 0;
let bootWallMs = 0;

/** The server clock: PILOTLIGHT_CLOCK_START advanced in real time. */
export function now(): Date {
  environment();
  return new Date(bootEpoch + (Date.now() - bootWallMs));
}

export function nowMs(): number {
  environment();
  return bootEpoch + (Date.now() - bootWallMs);
}

/** HTTP Date header value with seconds precision. */
export function httpDate(): string {
  return now().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
