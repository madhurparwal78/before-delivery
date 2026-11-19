import { config } from "./config.js";

const processStart = Date.now();
const clockStartMs = config.clockStart ? Date.parse(config.clockStart) : null;
if (config.clockStart && Number.isNaN(clockStartMs)) throw new Error("LOCKSET_CLOCK_START must be an ISO 8601 instant");

/** The server clock: real time, or the LOCKSET_CLOCK_START instant running forward in real time. */
export function now(): Date {
  if (clockStartMs === null) return new Date();
  return new Date(clockStartMs + (Date.now() - processStart));
}
