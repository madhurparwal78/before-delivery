// The instance's clock: every time rule reads the current instant as the machine clock plus CLOCK_OFFSET_SECONDS,
// including the rules that run inside the database, which receive this instant as a parameter
// (brief: Business rules, Instances and the clock).
import { config } from "./config.js";
const offsetMs = Math.round(config.clockOffsetSeconds * 1000);
export const now = () => Date.now() + offsetMs;
export const plusSeconds = (instant, seconds) => new Date(instant + seconds * 1000);
