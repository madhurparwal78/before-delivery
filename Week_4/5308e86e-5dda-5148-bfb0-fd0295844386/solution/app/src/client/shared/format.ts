/** Display formatting for dates and labels. Dates come from the server as YYYY-MM-DD or instants; none is computed from the browser's clock. */

const CALENDAR_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const FEED_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Tue, Jul 6, 2027" from "2027-07-06". */
export function calendarDate(date: string): string {
  const [year, month, day] = date.split("-").map((piece) => Number.parseInt(piece, 10));
  return CALENDAR_DATE.format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)));
}

/** "Oct 27": the New York calendar date of an instant. */
export function feedDate(instant: string): string {
  return FEED_DATE.format(new Date(instant));
}

interface MonthOption {
  value: string;
  label: string;
}

/** The current month (from the business date) and the eleven before it, newest first. */
export function statementMonths(businessDate: string, count: number): MonthOption[] {
  let year = Number.parseInt(businessDate.slice(0, 4), 10);
  let month = Number.parseInt(businessDate.slice(5, 7), 10);
  const options: MonthOption[] = [];
  for (let step = 0; step < count; step++) {
    options.push({ value: `${year}-${month < 10 ? "0" : ""}${month}`, label: `${MONTH_NAMES[month - 1]} ${year}` });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return options;
}

const METHOD_LABELS: Record<string, string> = { ach: "ACH", wire: "Wire", rtp: "RTP", check: "Check", card: "Card", transfer: "Transfer" };

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

/** Two-letter initials: the first letters of the first two words, or the first two letters of one word. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "");
  const first = [...(words[0] ?? "")];
  const second = [...(words[1] ?? "")];
  return (words.length > 1 ? first.slice(0, 1).concat(second.slice(0, 1)) : first.slice(0, 2)).join("").toUpperCase();
}
