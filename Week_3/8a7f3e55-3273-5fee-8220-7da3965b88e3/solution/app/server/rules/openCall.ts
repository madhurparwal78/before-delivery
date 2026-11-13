import type { OpenCallStatus } from "../../shared/api.js";
import { addMinutes } from "../agency.js";

/** The open call closes exactly `leadMinutes` real minutes before the start instant. */
export const openCallClosesAt = (startMs: number, leadMinutes: number): number => addMinutes(startMs, -leadMinutes);

/** `none` before an open call is posted, `open` while the server clock is before the close instant, `closed` from then on. */
export function openCallStatus(closesAtMs: number | null, nowMs: number): OpenCallStatus {
  if (closesAtMs === null) return "none";
  return nowMs < closesAtMs ? "open" : "closed";
}
