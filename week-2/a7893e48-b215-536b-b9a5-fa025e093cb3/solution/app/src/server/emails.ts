import { formatHours, formatMoney } from "../shared/format.js";
import { termsLine } from "./rules.js";
import { localStamp } from "./time.js";

export interface Email { subject: string; body: string }

export interface ConfirmedLine {
  localDate: string;
  startAt: Date;
  endAt: Date;
  minutes: number;
  packMinutes: number;
  cardCents: number;
  depositCents: number;
  paid: boolean;
  cutoffAt: Date;
}

export function confirmationEmail(siteName: string, zone: string, stationName: string, noticeHours: number, lines: ConfirmedLine[]): Email {
  const first = lines[0]?.localDate ?? "";
  const subject = lines.length === 1
    ? `Booking confirmed: ${stationName} on ${first}`
    : `Booking confirmed: ${stationName}, ${lines.length} dates from ${first}`;
  const blocks = lines.map((line) => [
    `${line.localDate}: ${localStamp(zone, line.startAt)} to ${localStamp(zone, line.endAt)}, ${formatHours(line.minutes)} h`,
    `  Pack hours: ${formatHours(line.packMinutes)} h`,
    `  Card charged now: ${formatMoney(line.paid ? line.cardCents : 0)}`,
    `  Deposit: ${formatMoney(line.depositCents)}`,
    line.paid ? "  Balance: $0.00" : `  Balance: ${formatMoney(line.cardCents)} due by ${localStamp(zone, line.cutoffAt)}`,
  ].join("\n"));
  return {
    subject,
    body: [`Hearthshift — ${siteName}`, `${stationName}`, "", ...blocks.flatMap((block) => [block, ""]), termsLine(noticeHours), ""].join("\n"),
  };
}

export function holdExpiredEmail(stationName: string, localDate: string, siteName: string): Email {
  return {
    subject: `Hold expired: ${stationName} on ${localDate}`,
    body: `Your hold on ${stationName} at ${siteName} for ${localDate} ran out before checkout, and the time was released. Nothing was charged.\n`,
  };
}

export function unpaidCancellationEmail(stationName: string, localDate: string, zone: string, cutoffAt: Date): Email {
  return {
    subject: `Booking cancelled: balance unpaid for ${stationName} on ${localDate}`,
    body: `The card balance for ${stationName} on ${localDate} was still unpaid at the cutoff, ${localStamp(zone, cutoffAt)}, so the booking was cancelled. The deposit was kept.\n`,
  };
}

export function expiryReminderEmail(kind: "liability" | "food_handler", expiresOn: string): Email {
  const what = kind === "liability" ? "liability certificate" : "food handler card";
  return {
    subject: `Your ${what} expires on ${expiresOn}`,
    body: `Your ${what} on file expires on ${expiresOn}. Upload a current one in Hearthshift under Documents so your bookings can be confirmed.\n`,
  };
}
