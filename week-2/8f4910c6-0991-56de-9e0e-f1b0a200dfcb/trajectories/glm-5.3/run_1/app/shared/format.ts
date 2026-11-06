/** Formatting of dates, times and money for screens and emails. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDay(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[weekday]} ${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

export function formatDayShort(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[weekday]} ${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Office-time format: "Fri 12 Mar 2027, 12:00 Toronto time". */
export function formatOfficeTime(instant: Date, timeZone: string, city: string): string {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(instant)) parts[p.type] = p.value;
  const hour = (parts.hour === "24" ? "00" : parts.hour);
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${hour}:${parts.minute} ${city} time`;
}

/** CAD 1,234.50 from integer cents. */
export function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-CA");
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}CAD ${whole}.${frac}`;
}

/** Decimal string like -500.00 for CSV. */
export function moneyDecimal(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 173 cm / 5 ft 8 in ; 84 cm / 33 in ; null-safe. */
export function formatHeight(cm: number | null): string | null {
  if (cm === null) return null;
  return `${cm} cm / ${ftIn(cm)}`;
}

export function formatGirth(cm: number | null): string | null {
  if (cm === null) return null;
  return `${cm} cm / ${inches(cm)} in`;
}

function inches(cm: number): number {
  return Math.round(cm / 2.54);
}

function ftIn(cm: number): string {
  const total = inches(cm);
  return `${Math.floor(total / 12)} ft ${total % 12} in`;
}

/** Truncating compact reach: 374650 -> "374.6K". */
export function formatReach(n: number): string {
  if (n < 1000) return String(n);
  const units: Array<[number, string]> = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) {
    if (n >= size) {
      const whole = Math.floor(n / size);
      const tenth = Math.floor((n % size) / (size / 10));
      const s = tenth === 0 ? String(whole) : `${whole}.${tenth}`;
      return `${s}${suffix}`;
    }
  }
  return String(n);
}
