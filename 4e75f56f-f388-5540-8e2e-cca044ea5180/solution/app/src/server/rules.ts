// Each domain rule of the brief is decided here and nowhere else.
import { config } from "./config.js";
import { conflict } from "./http.js";
import { openCourseDay } from "../shared/courseDays.js";

export type Tier = "bench" | "atelier";
export type ReservationState =
  | "held"
  | "deposit_paid"
  | "paid_in_full"
  | "checked_in_day1"
  | "checked_in_day2"
  | "certificate_issued"
  | "released"
  | "cancelled"
  | "refunded";

export const SEATS_TOTAL = 24;
const ROWS = ["A", "B", "C", "D"] as const;
export const BENCH_LABELS: readonly string[] = ROWS.flatMap((row) => [1, 2, 3, 4, 5, 6].map((n) => `${row}${n}`));
export const MAX_GROUP_BENCHES = 6;

export function isBenchLabel(value: unknown): value is string {
  return typeof value === "string" && BENCH_LABELS.includes(value);
}

export function tierOf(bench: string): Tier {
  return bench.startsWith("A") || bench.startsWith("B") ? "atelier" : "bench";
}

export const TIER_NAME: Record<Tier, string> = { bench: "Bench", atelier: "Atelier" };

export { PRICES, upgradeCharge } from "../shared/prices.js";


// ---- Reservation state machine ------------------------------------------------------------

export const ACTIVE_STATES: readonly ReservationState[] = [
  "held",
  "deposit_paid",
  "paid_in_full",
  "checked_in_day1",
  "checked_in_day2",
  "certificate_issued",
];
export const SOLD_STATES: readonly ReservationState[] = ACTIVE_STATES.filter((state) => state !== "held");

const MOVES: Record<ReservationState, readonly ReservationState[]> = {
  held: ["deposit_paid", "paid_in_full", "released"],
  deposit_paid: ["paid_in_full", "cancelled"],
  paid_in_full: ["checked_in_day1", "cancelled"],
  checked_in_day1: ["checked_in_day2"],
  checked_in_day2: ["certificate_issued"],
  certificate_issued: [],
  released: [],
  cancelled: ["refunded"],
  refunded: [],
};

export function assertMove(from: ReservationState, to: ReservationState): void {
  if (!MOVES[from].includes(to)) throw conflict("invalid_transition", `A ${from} reservation cannot become ${to}.`);
}

// ---- Atelier cap ----------------------------------------------------------------------------

export const ATELIER_CAP = 10;

/** Atelier places still claimable given the active Atelier reservations (live offers included). */
export function atelierRoom(activeAtelier: number): number {
  return Math.max(0, ATELIER_CAP - activeAtelier);
}

// ---- Venue dates ----------------------------------------------------------------------------

const DEPOSIT_DEADLINE = "2027-03-19";
const EARLY_REFUND_END = "2027-01-15";
const REMINDER_21_FROM = "2027-02-26";
const REMINDER_7_FROM = "2027-03-12";

const venueDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

/** The venue-local date (America/Chicago, real zone rules) of BENCH_DAYS_NOW when set, else of `now`. */
export function venueToday(now: Date): string {
  return venueDate.format(config.benchDaysNow ?? now);
}

export function depositsOpen(today: string): boolean {
  return today <= DEPOSIT_DEADLINE;
}

/** Which balance reminder is due today for a deposit_paid seat, if any. */
export function reminderDue(today: string): "21" | "7" | null {
  if (today > DEPOSIT_DEADLINE) return null;
  if (today >= REMINDER_7_FROM) return "7";
  if (today >= REMINDER_21_FROM) return "21";
  return null;
}

export { openCourseDay } from "../shared/courseDays.js";

// ---- Refund schedule --------------------------------------------------------------------------

const REFUND_FEE = 25_000;

/** Refund due in integer cents for a cancellation on `today`, or null when the window has closed. */
export function refundDue(paidCents: number, today: string): number | null {
  if (today <= EARLY_REFUND_END) return Math.max(0, paidCents - REFUND_FEE);
  if (today <= DEPOSIT_DEADLINE) return Math.floor(paidCents / 2);
  return null;
}

// ---- Check-in --------------------------------------------------------------------------------

export type CheckinConflict = "checkin_closed" | "no_attendee" | "already_checked_in" | "balance_due" | "not_checked_in_day1";

/** The first check-in conflict in the brief's order; any other illegal move is the state machine's. */
export function checkinConflict(
  seat: { state: ReservationState; attendeeAccepted: boolean; checkedIn: { day1: boolean; day2: boolean } },
  day: 1 | 2,
  today: string,
): CheckinConflict | null {
  if (openCourseDay(today) !== day) return "checkin_closed";
  if (!seat.attendeeAccepted) return "no_attendee";
  if (day === 1 ? seat.checkedIn.day1 : seat.checkedIn.day2) return "already_checked_in";
  if (seat.state === "deposit_paid") return "balance_due";
  if (day === 2 && seat.state === "paid_in_full") return "not_checked_in_day1";
  return null;
}

// ---- Certificate eligibility -----------------------------------------------------------------

type CertificateGap = "balance_unpaid" | "day1_check_in" | "day2_check_in" | "licence_not_matched";

export function certificateGaps(seat: {
  balanceCents: number;
  checkedIn: { day1: boolean; day2: boolean };
  licenceStatus: string;
}): CertificateGap[] {
  const gaps: CertificateGap[] = [];
  if (seat.balanceCents > 0) gaps.push("balance_unpaid");
  if (!seat.checkedIn.day1) gaps.push("day1_check_in");
  if (!seat.checkedIn.day2) gaps.push("day2_check_in");
  if (seat.licenceStatus !== "matched") gaps.push("licence_not_matched");
  return gaps;
}
