export { formatHours as hours, formatMoney as money } from "../shared/format.js";

const formats = new Map<string, Intl.DateTimeFormat>();

function parts(zone: string, at: number): Record<string, string> {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
    formats.set(zone, format);
  }
  return Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
}

/** `<HH:MM>` in the site's zone. */
export function clock(zone: string, at: string | number): string {
  const p = parts(zone, typeof at === "string" ? Date.parse(at) : at);
  return `${p.hour}:${p.minute}`;
}

/** `<local date>` in the site's zone. */
export function localDate(zone: string, at: string | number): string {
  const p = parts(zone, typeof at === "string" ? Date.parse(at) : at);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Calendar step on a YYYY-MM-DD string. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && shiftDate(value, 0) === value;

/** "2026-11-01 01:00 CDT" split into its date and its time-with-zone. */
export function stampParts(stamp: string): { date: string; time: string } {
  return { date: stamp.slice(0, 10), time: stamp.slice(11) };
}

export const STATUS_STAMPS: Record<string, string> = {
  held: "Held", expired: "Expired", confirmed: "Confirmed", checked_in: "Checked in", overrun_billed: "Overrun billed",
  checked_out: "Checked out", settled: "Settled", cancelled_refunded: "Cancelled — refunded",
  cancelled_forfeit: "Cancelled — forfeited", unpaid_cancelled: "Cancelled — unpaid",
};
