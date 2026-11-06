// Dates as the brief prints them ("Sat 24 Oct"), always from the workspace calendar date the
// server sent, never from the browser's clock or zone.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday: day === 0 ? 6 : day - 1 };
}

/** "Sat 24 Oct" */
export function showDate(date: string): string {
  const { m, d, weekday } = parts(date);
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}`;
}

/** "24 Oct", the crease label. */
export function shortDate(date: string): string {
  const { m, d } = parts(date);
  return `${d} ${MONTHS[m - 1]}`;
}

export function weekdayOf(date: string): string {
  return WEEKDAYS[parts(date).weekday] as string;
}

/** The 24-hour wall time of an instant the server sent with the workspace offset. */
export function showTime(instant: string): string {
  return instant.slice(11, 16);
}

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parts(value);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
