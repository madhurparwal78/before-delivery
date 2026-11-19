// The complete list of messages: recipients, subjects and plain-text bodies from the brief's Services table.
import { money, quartersText } from "../shared/format.ts";
import { formatWall, type IsoDate } from "../shared/time.ts";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "../shared/api.ts";
import type { Cents, Quarters } from "../shared/rules.ts";
import type { Message } from "./smtp.ts";

export interface BookingMailFacts {
  to: string;
  station: string;
  site: string;
  reference: string;
  date: IsoDate;
  start: number;
  end: number;
  quarters: Quarters;
}

function slot(b: BookingMailFacts): string {
  return `${b.station}, ${b.date} ${formatWall(b.start)}-${formatWall(b.end)}`;
}

export function bookingConfirmedMail(b: BookingMailFacts, availableAfter: Quarters): Message {
  return {
    to: b.to,
    subject: `Booking confirmed: ${slot(b)}`,
    body: [
      `Your booking is confirmed.`,
      ``,
      `Site: ${b.site}`,
      `Station: ${b.station}`,
      `When: ${b.date} ${formatWall(b.start)}-${formatWall(b.end)}`,
      `Reference: ${b.reference}`,
      `Hours: ${quartersText(b.quarters)}`,
      `Available pack hours after this booking: ${quartersText(availableAfter)}`,
    ].join("\n"),
  };
}

export function seriesBookedMail(
  to: string,
  facts: { station: string; site: string; weekday: string; start: number; end: number; dates: IsoDate[]; totalQuarters: Quarters },
): Message {
  return {
    to,
    subject: `Weekly booking confirmed: ${facts.station}, ${facts.weekday}s ${formatWall(facts.start)}-${formatWall(facts.end)}, ${facts.dates.length} weeks`,
    body: [
      `Your weekly booking is confirmed.`,
      ``,
      `Site: ${facts.site}`,
      `Station: ${facts.station}`,
      `Every ${facts.weekday} ${formatWall(facts.start)}-${formatWall(facts.end)}`,
      `Dates:`,
      ...facts.dates.map((date) => `  ${date}`),
      `Total hours: ${quartersText(facts.totalQuarters)}`,
    ].join("\n"),
  };
}

export function bookingCancelledMail(
  b: BookingMailFacts,
  refunded: Quarters,
  forfeited: Quarters,
  byStaff: { reason: string } | null,
): Message {
  return {
    to: b.to,
    subject: `Booking cancelled: ${slot(b)}`,
    body: [
      `Your booking ${b.reference} at ${b.site} is cancelled.`,
      ``,
      `Refunded pack hours: ${quartersText(refunded)}`,
      `Forfeited pack hours: ${quartersText(forfeited)}`,
      ...(byStaff ? [`Cancelled by ${b.site} staff. Reason: ${byStaff.reason}`] : []),
    ].join("\n"),
  };
}

export function receiptMail(
  to: string,
  facts: { packName: string; quarters: Quarters; priceCents: Cents; purchaseId: string; validThrough: IsoDate; availableAfter: Quarters },
): Message {
  return {
    to,
    subject: `Receipt: ${facts.packName} (${quartersText(facts.quarters)} pack hours)`,
    body: [
      `Thank you for your purchase.`,
      ``,
      `Pack: ${facts.packName}`,
      `Amount: $${money(facts.priceCents)}`,
      `Purchase id: ${facts.purchaseId}`,
      `Valid through ${facts.validThrough}`,
      `Available pack hours after this purchase: ${quartersText(facts.availableAfter)}`,
    ].join("\n"),
  };
}

export type NoticeKind = "14-day" | "3-day";

export function expiryNoticeMail(to: string, type: DocumentType, validThrough: IsoDate, notice: NoticeKind): Message {
  const label = DOCUMENT_TYPE_LABELS[type];
  return {
    to,
    subject: `${label} expires ${validThrough} (${notice} notice)`,
    body: [
      `Your ${label.toLowerCase()} is valid through ${validThrough}.`,
      ``,
      `Upload a current document on the Documents screen so your kitchen manager can verify it before then.`,
    ].join("\n"),
  };
}

/** Carries only the truck name, the commissary site name, the link and its expiry in site time. */
export function inspectorLinkMail(
  to: string,
  facts: { truckName: string; siteName: string; url: string; expiresLocal: string; timeZone: string },
): Message {
  return {
    to,
    subject: `Commissary visit log: ${facts.truckName}`,
    body: [
      `Commissary visit log: ${facts.truckName}`,
      `Commissary: ${facts.siteName}`,
      ``,
      `Open the read-only log: ${facts.url}`,
      `This link works until ${facts.expiresLocal} (${facts.timeZone}).`,
    ].join("\n"),
  };
}
