// Dates, times and amounts as the screens print them. Every instant is shown in the facilitator's time zone.
import { formatAmount } from "../shared/copy.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2027-03-04" → "4 Mar 2027". */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""} ${year}`;
}

function zoned(iso: string, zone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** An instant as "4 Mar 2027" in the zone. */
export function instantDate(iso: string, zone: string): string {
  return formatDate(zoned(iso, zone).date);
}

/** An instant as "HH:mm" in the zone. */
export function instantTime(iso: string, zone: string): string {
  return zoned(iso, zone).time;
}

/** An instant as "4 Mar 2027, 14:00" in the zone. */
export function instantDateTime(iso: string, zone: string): string {
  const z = zoned(iso, zone);
  return `${formatDate(z.date)}, ${z.time}`;
}

/** A local wall-clock "YYYY-MM-DDTHH:MM" as "4 Mar 2027, 14:00". */
export function wallClock(local: string): string {
  const [date = "", time = ""] = local.split("T");
  return `${formatDate(date)}, ${time}`;
}

export function euro(amount: string): string {
  return `€${formatAmount(amount)}`;
}

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function noteCount(n: number): string {
  return n === 1 ? "1 note" : `${n} notes`;
}
