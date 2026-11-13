import { brusselsDate, wallClock, weekdayIndex } from "./brussels";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const two = (value: number): string => String(value).padStart(2, "0");

/** A date as `Tue 30 Mar 2027`. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${WEEKDAYS[weekdayIndex(date)]} ${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** A Brussels time as `14:30`. */
export function formatTime(instant: string | Date): string {
  const { hour, minute } = wallClock(new Date(instant));
  return `${two(hour)}:${two(minute)}`;
}

/** A Brussels date-time as `Tue 30 Mar 2027, 10:20`. */
export function formatDateTime(instant: string | Date): string {
  return `${formatDate(brusselsDate(new Date(instant)))}, ${formatTime(instant)}`;
}

/** A month as `March 2027`. */
export function formatMonth(month: string): string {
  const [year, number] = month.split("-");
  return `${MONTH_NAMES[Number(number) - 1]} ${year}`;
}

/** Integer cents as `€1,234.50`. */
export function formatMoney(cents: number): string {
  const whole = String((cents - (cents % 100)) / 100).replace(/\B(?=(\d{3})+$)/g, ",");
  return `€${whole}.${two(cents % 100)}`;
}

/** Integer cents as `1234.50`, for the files a bank or a bookkeeper reads. */
export function formatEuros(cents: number): string {
  return `${(cents - (cents % 100)) / 100}.${two(cents % 100)}`;
}

/** Euro text such as `49.90` as integer cents, or null when it is not an amount. */
export function parseEuros(text: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** An IBAN in groups of four. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

/** A Date as a whole-second UTC instant. */
export function formatInstant(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}
