// Rental sets: legal edges, the business-zone due date, overdue and the reminder date.

import type { RentalStatus, Role } from "../../shared/api.js";
import { addDays, wallClockToInstant } from "../../shared/london.js";

/** Each legal edge and the roles that may take it. */
export const RENTAL_EDGES: Record<RentalStatus, { from: RentalStatus; roles: readonly Role[] } | undefined> = {
  requested: undefined,
  received: { from: "requested", roles: ["principal_librarian"] },
  in_use: { from: "received", roles: ["principal_librarian"] },
  returned: { from: "in_use", roles: ["principal_librarian", "assistant_librarian"] },
  checked_in: { from: "returned", roles: ["principal_librarian"] },
};

const OPEN: ReadonlySet<RentalStatus> = new Set(["requested", "received", "in_use"]);

/** The business-zone date of the final performance plus 14 days. */
export function dueDate(finalPerformanceDate: string): string {
  return addDays(finalPerformanceDate, 14);
}

/** 23:59 London time on the due date. */
export function dueAt(due: string): number {
  const [year, month, day] = due.split("-").map(Number);
  return wallClockToInstant({ year: year ?? 0, month: month ?? 1, day: day ?? 1, hour: 23, minute: 59 }) ?? 0;
}

/** Overdue from 00:00 London time on the day after the due date, while the set is still out. */
export function isOverdue(status: RentalStatus, due: string, today: string): boolean {
  return OPEN.has(status) && today > due;
}

/** Returned after the instant the set was due. */
export function returnedLate(returnedAt: number | null, dueInstant: number): boolean {
  return returnedAt !== null && returnedAt > dueInstant;
}

/** Reminders go out from seven days before the due date while the set is still out. */
export function reminderDue(status: RentalStatus, due: string, today: string): boolean {
  return OPEN.has(status) && today >= addDays(due, -7);
}
