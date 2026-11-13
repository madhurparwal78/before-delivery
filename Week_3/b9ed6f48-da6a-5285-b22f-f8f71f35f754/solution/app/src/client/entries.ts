// Lisbon wall-clock entries (brief: Interactions › Date and time fields): read as Lisbon time on
// any device and sent with the offset Lisbon has at that wall time.

import { parseWallClockEntry, toLisbonIso, wallClockToInstant } from "../shared/lisbon.js";
import { COPY } from "../shared/copy.js";

/** The ISO instant to send, or the field error to show (and send nothing). */
export function readLisbonEntry(text: string): { iso: string } | { error: string } {
  const wall = parseWallClockEntry(text);
  if (!wall) return { error: COPY.afterNow };
  const instant = wallClockToInstant(wall);
  return instant === "skipped" ? { error: COPY.skippedTime } : { iso: toLisbonIso(instant) };
}

export const LISBON_ENTRY_HINT = "Lisbon time, as YYYY-MM-DD HH:MM:SS, for example 2026-11-14 18:30:05. The seconds may be left out.";
