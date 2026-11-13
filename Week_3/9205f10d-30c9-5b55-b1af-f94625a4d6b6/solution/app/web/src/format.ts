/** Display copy for agency times, statuses and seats. Every clock shown is agency time. */
import { agencyDate, clockLabels, dayLabel, longDate, monthDayOf } from "../../shared/agencyTime";
import type { ApiRequest, RequestStatus, Seat } from "./types";

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Draft",
  submitted: "Open seat",
  "half-staffed": "Half-staffed",
  staffed: "Staffed",
  completed: "Completed",
  invoiced: "Invoiced",
  cancelled_early: "Cancelled",
  cancelled_late: "Cancelled (late fee)",
};

export const SETTING_LABEL = { medical: "Medical", education: "Education", legal: "Legal" } as const;

export const CANCELLED: readonly RequestStatus[] = ["cancelled_early", "cancelled_late"];

/** "9:00 AM" */
export const clockOf = (iso: string): string => clockLabels(new Date(iso)).clock;

/** "Nov 3" */
export const monthDayOfInstant = (iso: string): string => clockLabels(new Date(iso)).monthDay;

/** The agency calendar date of an instant, YYYY-MM-DD. */
export const agencyDateOf = (iso: string): string => agencyDate(new Date(iso));

/** "Tue, Nov 3, 2026" */
export function dateLine(iso: string): string {
  return `${clockLabels(new Date(iso)).weekday}, ${longDate(agencyDateOf(iso))}`;
}

/** The time window's two ends: "9:00 AM" and "11:00 AM EST". */
export function windowParts(request: Pick<ApiRequest, "starts_at" | "ends_at">): { start: string; end: string } {
  const end = clockLabels(new Date(request.ends_at));
  return { start: clockOf(request.starts_at), end: `${end.clock} ${end.zone}` };
}

/** "Sun, Nov 1, 9:00 AM EST": weekday, month and day, clock, and the zone in force then. */
export function cutoffText(iso: string): string {
  const labels = clockLabels(new Date(iso));
  return `${labels.weekday}, ${labels.monthDay}, ${labels.clock} ${labels.zone}`;
}

/** "Dec 31, 2030" for a date, or a date-time's agency date. */
export const longDateOf = (isoDate: string): string => longDate(isoDate.slice(0, 10));

export { dayLabel, monthDayOf };

/** How a seat reads to the viewer: the interpreter's name, "taken" or "open". */
export function seatWho(seat: Seat): string {
  if (seat.status === "open") return "open";
  return seat.interpreter?.display_name ?? "taken";
}

export const confirmedCount = (request: ApiRequest): number => request.seats.filter((s) => s.status === "confirmed").length;

/** "<Setting> · <credential> · <Weekday>, <Mon D> · <start> to <end> · <city> · Seat <label>" */
export function seatLine(request: ApiRequest, label: string): string {
  const start = clockLabels(new Date(request.starts_at));
  return [
    SETTING_LABEL[request.setting],
    request.required_credential,
    `${start.weekday}, ${start.monthDay}`,
    `${start.clock} to ${clockOf(request.ends_at)}`,
    request.city,
    `Seat ${label}`,
  ].join(" · ");
}
