import type { Status } from "../../shared/types";
import { UNFILED } from "./status";

/** Overdue: unfiled and the practice clock is after the deadline, never at the deadline itself. */
export function isOverdue(status: Status, dueAtMs: number, nowMs: number): boolean {
  return UNFILED.includes(status) && nowMs > dueAtMs;
}

/** A band strip is past once the practice clock is at or after the deadline. */
export function isPast(dueAtMs: number, nowMs: number): boolean {
  return nowMs >= dueAtMs;
}
