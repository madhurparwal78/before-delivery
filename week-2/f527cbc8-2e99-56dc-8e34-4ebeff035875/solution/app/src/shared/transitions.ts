// The barn day and booking edges (brief: Business rules, Barn day states and Bookings), written once. The server's
// rule modules refuse actions with them; the browser uses them to show a control only when its edge is legal.
// No imports: both the Node server and the browser bundle load this file.

export type StoredDayStatus = "draft" | "published" | "in_progress" | "closed" | "cancelled";
export type DayStatus = StoredDayStatus | "full";
export type DayAction = "edit" | "publish" | "start" | "close" | "cancel";

export const DAY_EDGES: Record<DayAction, { from: readonly DayStatus[]; to: StoredDayStatus }> = {
  edit: { from: ["draft"], to: "draft" },
  publish: { from: ["draft"], to: "published" },
  start: { from: ["published", "full"], to: "in_progress" },
  close: { from: ["in_progress"], to: "closed" },
  cancel: { from: ["draft", "published", "full"], to: "cancelled" },
};

export const dayActionAllowed = (status: DayStatus, action: DayAction): boolean => DAY_EDGES[action].from.includes(status);

export type BookingStatus = "held" | "confirmed" | "cancelled_in_time" | "cancelled_late" | "worked" | "no_show" | "excused";
/** Holds that are gone stay as rows so a confirm can answer hold_expired, but never appear in any list. */
type GoneHoldStatus = "released" | "lapsed" | "removed";
export type StoredBookingStatus = BookingStatus | GoneHoldStatus;
export type BookingAction = "confirm" | "release" | "lapse" | "remove" | "cancel" | "open_visit" | "no_show" | "excuse";

export const BOOKING_EDGES: Record<BookingAction, { from: StoredBookingStatus; to: StoredBookingStatus }> = {
  confirm: { from: "held", to: "confirmed" },
  release: { from: "held", to: "released" },
  lapse: { from: "held", to: "lapsed" },
  remove: { from: "held", to: "removed" },
  cancel: { from: "confirmed", to: "cancelled_in_time" },
  open_visit: { from: "confirmed", to: "worked" },
  no_show: { from: "confirmed", to: "no_show" },
  excuse: { from: "confirmed", to: "excused" },
};

export const bookingActionAllowed = (status: StoredBookingStatus, action: BookingAction): boolean =>
  BOOKING_EDGES[action].from === status;

/** Opening a visit and marking a no-show need the day in progress (the day_not_in_progress guard). */
export const dayIsWorking = (status: DayStatus): boolean => status === "in_progress";
