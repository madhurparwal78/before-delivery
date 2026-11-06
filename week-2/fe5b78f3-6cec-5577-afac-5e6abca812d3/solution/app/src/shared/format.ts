// Display formats the brief pins: money, status labels, spoken status lines and IST dates.
// Every time arrives from the API as an IST timestamp, so formatting reads its digits and never a device clock.
import type { BerthType, PassengerStatus } from "./api.js";

export function formatInr(paise: number): string {
  const rupees = Math.floor(paise / 100);
  let digits = String(rupees);
  if (digits.length > 3) {
    let head = digits.slice(0, -3);
    let grouped = digits.slice(-3);
    while (head.length > 2) {
      grouped = `${head.slice(-2)},${grouped}`;
      head = head.slice(0, -2);
    }
    digits = `${head},${grouped}`;
  }
  return `₹${digits}.${String(paise % 100).padStart(2, "0")}`;
}

export const POSITION_WORD: Record<BerthType, string> = {
  LB: "lower",
  MB: "middle",
  UB: "upper",
  SL: "side lower",
  SU: "side upper",
};

function spokenStatus(status: PassengerStatus): string {
  switch (status.status) {
    case "CNF":
      return `CNF, ${status.coach} berth ${status.berth}, ${status.berth_type ? POSITION_WORD[status.berth_type] : ""}`;
    case "CAN":
      return "cancelled";
    case "CHART_NOT_CONFIRMED":
      return "not confirmed, refund pending";
    case "NOSB":
      return "NOSB";
    default:
      return `${status.status} ${status.position}`;
  }
}

export function announcementLine(number: number, from: PassengerStatus, to: PassengerStatus): string {
  return `Passenger ${number}: ${spokenStatus(from)} to ${spokenStatus(to)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateParts(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

/** `Wed 2 Dec 2026` for an ISO date or an IST timestamp. */
export function longDate(isoDateOrTimestamp: string): string {
  const { year, month, day } = dateParts(isoDateOrTimestamp);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]} ${year}`;
}

/** `02 DEC 2026`. */
export function labelDate(isoDateOrTimestamp: string): string {
  const { year, month, day } = dateParts(isoDateOrTimestamp);
  return `${String(day).padStart(2, "0")} ${(MONTHS[month - 1] ?? "").toUpperCase()} ${year}`;
}

const IST_OFFSET_MS = 5.5 * 3600_000;

/** An instant as an IST timestamp with seconds: `2026-12-01T11:00:00+05:30`. */
export function istTimestamp(ms: number): string {
  return `${new Date(Math.floor(ms / 1000) * 1000 + IST_OFFSET_MS).toISOString().slice(0, 19)}+05:30`;
}

/** `09:05` from an IST timestamp. */
export function istTime(timestamp: string): string {
  return timestamp.slice(11, 16);
}
