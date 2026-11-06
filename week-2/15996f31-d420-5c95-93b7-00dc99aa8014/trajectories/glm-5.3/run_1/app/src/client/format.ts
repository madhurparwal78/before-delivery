/** The one set of people-facing formats, mirroring the server's. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDateText(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTHS[month! - 1]} ${day}, ${year}`;
}

/** Pacific date-time like `Feb 5, 2027, 3:30 PM`. */
export function formatDateTimeText(iso: string): string {
  const at = new Date(iso.includes("T") ? iso : `${iso}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder}`;
}

export function formatAverage(average: number | null | undefined): string {
  if (average === null || average === undefined) return "no samples";
  return average.toFixed(1);
}

/** The current Pacific wall-clock date and time, whatever the browser zone. */
export function pacificNow(): { date: string; time: string; offsetMinutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const offsetMinutes = pacificOffsetMinutes(now);
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`, offsetMinutes };
}

/** The Pacific UTC offset in effect at the given instant, in minutes east of UTC. */
export function pacificOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const asUtc = Date.UTC(
    Number(get("year")), Number(get("month")) - 1, Number(get("day")),
    Number(get("hour")) % 24, Number(get("minute")), Number(get("second")),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** A Pacific wall-clock date and time as an ISO instant with its offset. */
export function pacificInstant(date: string, time: string): string {
  const offset = pacificOffsetMinutes(new Date(`${date}T${time}:00Z`));
  const sign = offset < 0 ? "-" : "+";
  const absOffset = Math.abs(offset);
  const hh = Math.floor(absOffset / 60).toString().padStart(2, "0");
  const mm = (absOffset % 60).toString().padStart(2, "0");
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  filled: "Filled",
  placed: "Placed",
  inspected: "Inspected",
  settled: "Settled",
  cancelled: "Cancelled",
};

export const DROP_STATUS_LABELS: Record<string, string> = {
  committed: "Committed",
  delivered: "Delivered",
  inspected: "Inspected",
  disputed: "Disputed",
  accepted: "Accepted",
};

export const LINK_STATUS_LABELS: Record<string, string> = {
  issued: "Issued",
  used: "Used",
  signed: "Signed",
  expired: "Expired",
};

export const TIER_LABELS: Record<string, string> = {
  none: "None",
  reduced: "Reduced",
  standard: "Standard",
  bonus: "Bonus",
};

export function orderStatusLabel(order: { status: string; settlement_status: string }): string {
  if (order.status === "inspected" && order.settlement_status === "queued") return "Settlement queued";
  return ORDER_STATUS_LABELS[order.status] ?? order.status;
}
