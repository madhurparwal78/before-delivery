import { config } from "./config.js";

// The app clock: host time plus APP_CLOCK_OFFSET_SECONDS, read once at start.
const offsetMs = config.clockOffsetSeconds * 1000;

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}
