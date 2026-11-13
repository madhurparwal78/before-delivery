import type { BookingStatus, CoverageState, Setting } from "../../shared/api.js";
import { AGENCY } from "../agency.js";

export type Phase = "active" | "in_progress" | "completed" | "cancelled" | "cancelled_late";

/** A booking has two seats when it is longer than the solo threshold or is a legal setting. */
export const seatCountFor = (durationMinutes: number, setting: Setting): number =>
  durationMinutes > AGENCY.soloThresholdMinutes || setting === "legal" ? 2 : 1;

export function coverageState(seatCount: number, heldCount: number): CoverageState {
  if (heldCount === 0) return "uncovered";
  return heldCount >= seatCount ? "covered" : "partly_covered";
}

/** Before check-in a booking's status follows from its seats; afterwards from its phase. */
export function bookingStatus(
  phase: Phase,
  seatCount: number,
  heldCount: number,
  openCallPosted: boolean,
): BookingStatus {
  if (phase !== "active") return phase;
  const coverage = coverageState(seatCount, heldCount);
  if (coverage === "covered") return "covered";
  if (coverage === "partly_covered") return "partially_covered";
  return openCallPosted ? "open" : "submitted";
}
