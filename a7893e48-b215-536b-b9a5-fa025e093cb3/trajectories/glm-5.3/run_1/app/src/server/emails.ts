import { money, hours } from "../shared/types.js";
import { localStamp, localDate } from "../shared/time.js";

export interface EmailBookingLine {
  station_name: string;
  site_name: string;
  start_at: number;
  end_at: number;
  minutes: number;
  tz: string;
  pack_minutes: number;
  deposit_cents: number;
  paid_now_cents: number;
  balance_cents: number;
  balance_due_by: number | null;
  notice_hours: number;
}

export function confirmationEmail(bookings: EmailBookingLine[]): { subject: string; body: string } {
  const first = bookings[0];
  const firstDate = localDate(first.tz, first.start_at);
  const multi = bookings.length > 1;
  const subject = multi
    ? `Booking confirmed: ${first.station_name}, ${bookings.length} dates from ${firstDate}`
    : `Booking confirmed: ${first.station_name} on ${firstDate}`;
  const lines: string[] = [first.site_name, ""];
  for (const b of bookings) {
    lines.push(`${localDate(b.tz, b.start_at)}`);
    lines.push(`  ${localStamp(b.tz, b.start_at)} to ${localStamp(b.tz, b.end_at)}`);
    lines.push(`  ${hours(b.minutes)} h`);
    lines.push(`  Pack hours: ${hours(b.pack_minutes)} h`);
    lines.push(`  Card charged now: ${money(b.paid_now_cents)}`);
    if (b.deposit_cents > 0) lines.push(`  Deposit: ${money(b.deposit_cents)}`);
    if (b.balance_cents > 0 && b.balance_due_by) lines.push(`  Balance ${money(b.balance_cents)} due by ${localStamp(b.tz, b.balance_due_by)}`);
    lines.push(`  ${terms(b.notice_hours)}`);
    lines.push("");
  }
  return { subject, body: lines.join("\n") };
}

export const terms = (notice: number): string =>
  `Free cancellation until ${notice} hours before start. Later cancellations keep the time charge and the deposit.`;

export function holdExpiredEmail(stationName: string, date: string): { subject: string; body: string } {
  return {
    subject: `Hold expired: ${stationName} on ${date}`,
    body: `Your hold on ${stationName} on ${date} ran out and the time was released.`,
  };
}

export function unpaidCancelEmail(stationName: string, date: string, cutoff: string): { subject: string; body: string } {
  return {
    subject: `Booking cancelled: balance unpaid for ${stationName} on ${date}`,
    body: `Your booking on ${stationName} on ${date} was cancelled because the balance was still unpaid at ${cutoff}. Your deposit was kept.`,
  };
}

export function expiryReminderEmail(kind: "liability" | "food_handler", date: string): { subject: string; body: string } {
  const what = kind === "liability" ? "liability certificate" : "food handler card";
  return {
    subject: `Your ${what} expires on ${date}`,
    body: `Your ${what} expires on ${date}. Please upload a new one.`,
  };
}
