// The server clock: PILOTLIGHT_CLOCK_START at the moment the process started, then real elapsed time. Milliseconds.
import { config } from "./config.ts";

export function now(): number {
  return Math.floor(config.clockStart === null ? Date.now() : config.clockStart + performance.now());
}
