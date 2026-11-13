import { config } from "./config.js";

/** The server clock: the real clock unless STOWDECK_NOW stands it still. */
export function now(): Date {
  return config.fixedNow ? new Date(config.fixedNow) : new Date();
}

/** ISO 8601 UTC with second precision and a trailing Z. */
export function isoSeconds(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}
