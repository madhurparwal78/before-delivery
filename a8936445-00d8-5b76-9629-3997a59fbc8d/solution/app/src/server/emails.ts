// Every email the kitchen sends (brief: Services, Email). Each goes to one tenant owner and
// mentions only that tenant's records.
import type { InvoiceLine } from "../shared/api";
import { KIND_LABELS, KITCHEN_NAME, type DocumentKind, type PayWith } from "../shared/kitchen";
import { dollars, hhmm } from "../shared/time";
import type { Email } from "./mail";
import { taxRatePercent } from "./rules";

const SIGNATURE = `\nStationkeeper at ${KITCHEN_NAME}\n`;

interface Owner {
  owner_name: string;
  owner_email: string;
  business_name: string;
}

export function bookingConfirmation(
  owner: Owner,
  holdRef: string,
  bookings: { ref: string; station_name: string; date: string; start_minute: number; end_minute: number; amount_cents: number | null }[],
  payWith: PayWith,
  policy: { version: number; free_window_hours: number; late_fee_percent: number },
): Email {
  const lines = bookings.map(
    (b) =>
      `  ${b.ref}  ${b.station_name}  ${b.date}  ${hhmm(b.start_minute)}-${hhmm(b.end_minute)}` +
      (payWith === "account" && b.amount_cents !== null ? `  ${dollars(b.amount_cents)}` : ""),
  );
  return {
    to: owner.owner_email,
    subject: `Stationkeeper: booking ${holdRef} confirmed`,
    body: [
      `Hello ${owner.owner_name},`,
      "",
      `${owner.business_name}'s booking ${holdRef} at ${KITCHEN_NAME} is confirmed.`,
      "",
      "Ref  Station  Date  Time",
      ...lines,
      "",
      `Payment: ${payWith === "account" ? "charged to your account" : "paid from your hour pack"}`,
      `Cancellation terms: policy v${policy.version}, free until ${policy.free_window_hours} hours before start, then ${policy.late_fee_percent}% charge.`,
      SIGNATURE,
    ].join("\n"),
  };
}

export function holdoverNotice(owner: Owner, bookingRef: string, reported: number, billed: number, amountCents: number): Email {
  return {
    to: owner.owner_email,
    subject: `Stationkeeper: hold-over recorded on ${bookingRef}`,
    body: [
      `Hello ${owner.owner_name},`,
      "",
      `Hold-over was recorded on booking ${bookingRef} for ${owner.business_name}.`,
      "",
      `Reported minutes past the booked end: ${reported}`,
      `Billed hold-over minutes: ${billed}`,
      `Amount charged to your account: ${dollars(amountCents)}`,
      SIGNATURE,
    ].join("\n"),
  };
}

export function expiryReminder(owner: Owner, kind: DocumentKind, holder: string | null, expiresOn: string): Email {
  return {
    to: owner.owner_email,
    subject: `Stationkeeper: ${KIND_LABELS[kind]} expires on ${expiresOn}`,
    body: [
      `Hello ${owner.owner_name},`,
      "",
      `${owner.business_name}'s ${KIND_LABELS[kind].toLowerCase()}${holder ? ` for ${holder}` : ""} expires on ${expiresOn}.`,
      "Upload a renewal in Stationkeeper under Documents so the kitchen can review it before then.",
      SIGNATURE,
    ].join("\n"),
  };
}

export function documentApproved(owner: Owner, kind: DocumentKind, expiresOn: string): Email {
  return {
    to: owner.owner_email,
    subject: `Stationkeeper: ${KIND_LABELS[kind]} approved`,
    body: [
      `Hello ${owner.owner_name},`,
      "",
      `The kitchen approved ${owner.business_name}'s ${KIND_LABELS[kind].toLowerCase()}. It counts through ${expiresOn}.`,
      SIGNATURE,
    ].join("\n"),
  };
}

export function documentRejected(owner: Owner, kind: DocumentKind, reason: string): Email {
  return {
    to: owner.owner_email,
    subject: `Stationkeeper: ${KIND_LABELS[kind]} needs attention`,
    body: [
      `Hello ${owner.owner_name},`,
      "",
      `The kitchen could not approve ${owner.business_name}'s ${KIND_LABELS[kind].toLowerCase()}.`,
      `Reason: ${reason}`,
      "",
      "Upload a corrected document in Stationkeeper under Documents.",
      SIGNATURE,
    ].join("\n"),
  };
}

export function invoiceNotice(
  owner: Owner,
  invoice: { number: string; period: string; lines: InvoiceLine[]; subtotal_cents: number; tax_rate_basis_points: number; tax_cents: number; total_cents: number },
): Email {
  return {
    to: owner.owner_email,
    subject: `Stationkeeper: invoice ${invoice.number} is ready`,
    body: [
      `Hello ${owner.owner_name},`,
      "",
      `Invoice ${invoice.number} for ${owner.business_name}, period ${invoice.period}, is ready in Stationkeeper under Billing.`,
      "",
      ...invoice.lines.map((l) => `  ${l.description}  ${dollars(l.amount_cents)}`),
      "",
      `Subtotal: ${dollars(invoice.subtotal_cents)}`,
      `Sales tax (${taxRatePercent(invoice.tax_rate_basis_points)}%): ${dollars(invoice.tax_cents)}`,
      `Total: ${dollars(invoice.total_cents)}`,
      SIGNATURE,
    ].join("\n"),
  };
}

export function invoiceReceipt(owner: Owner, number: string, total: number): Email {
  return {
    to: owner.owner_email,
    subject: `Stationkeeper: receipt for invoice ${number}`,
    body: [`Hello ${owner.owner_name},`, "", `Thank you. ${owner.business_name} paid invoice ${number}: ${dollars(total)}.`, SIGNATURE].join("\n"),
  };
}
