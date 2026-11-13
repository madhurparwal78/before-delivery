// Display formats from the brief's Feedback states (placeholder formats). Output only; no maths.

/** `<amount>`: `$5,269.95`. */
export function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `<date>` for a venue-local calendar date `YYYY-MM-DD`: `Tue 16 Mar 2027`. */
export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function monthName(month: number): string {
  return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month];
}

/** Basis points as a percent with two decimals: 2500 → `25.00`. */
export function percent(bp: number): string {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}`;
}

/** The displayed file name: last path segment, control characters removed, at most 120 characters. */
export function cleanFileName(given: string): string {
  const last = given.split(/[\\/]/).pop() ?? "";
  return last.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 120) || "file";
}

/** Metres with up to two decimals: 6.25 → `6.25`, 5.5 → `5.5`, 6 → `6`. */
export function metres(value: number): string {
  return String(Math.round(value * 100) / 100);
}
