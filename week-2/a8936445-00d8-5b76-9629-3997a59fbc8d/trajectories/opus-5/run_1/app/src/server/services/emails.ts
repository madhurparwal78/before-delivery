import { DOCUMENT_KIND_LABELS, KITCHEN, type DocumentKind } from '../domain/constants.js';
import { formatAmount } from '../domain/money.js';
import type {
  BookingRecord,
  InvoiceRecord,
  PolicyRecord,
  StationRecord,
  TenantRecord,
} from '../domain/types.js';
import type { OutgoingEmail } from '../providers/smtp.js';

function signature(): string {
  return `\n${KITCHEN.name}\n`;
}

export function bookingConfirmationEmail(
  tenant: TenantRecord,
  holdRef: string,
  bookings: readonly BookingRecord[],
  stationsById: ReadonlyMap<string, StationRecord>,
  policy: PolicyRecord,
): OutgoingEmail {
  const lines = bookings.map((booking) => {
    const station = stationsById.get(booking.stationId);
    const payment = booking.payWith === 'hour_pack' ? 'Hour pack' : `Account ${formatAmount(booking.amountCents ?? 0)}`;
    return `${booking.ref} — ${station ? station.name : booking.stationId}, ${booking.date}, ${booking.startLocal}–${booking.endLocal}, ${payment}`;
  });
  return {
    to: tenant.ownerEmail,
    subject: `Stationkeeper: booking ${holdRef} confirmed`,
    body: [
      `${tenant.businessName}, your hold ${holdRef} is confirmed.`,
      '',
      ...lines,
      '',
      `Cancellation policy v${policy.version}: free until ${policy.freeWindowHours} hours before start, then ${policy.lateFeePercent}% charge.`,
      signature(),
    ].join('\n'),
  };
}

export function holdoverNoticeEmail(
  tenant: TenantRecord,
  booking: BookingRecord,
  station: StationRecord,
  reportedMinutes: number,
  billedMinutes: number,
  amountCents: number,
): OutgoingEmail {
  return {
    to: tenant.ownerEmail,
    subject: `Stationkeeper: hold-over recorded on ${booking.ref}`,
    body: [
      `${tenant.businessName} stayed past the booked end on ${booking.ref}.`,
      '',
      `Station: ${station.name}`,
      `Booked: ${booking.date} ${booking.startLocal}–${booking.endLocal}`,
      `Reported hold-over: ${reportedMinutes} min`,
      `Billed hold-over: ${billedMinutes} min`,
      `Amount: ${formatAmount(amountCents)}`,
      signature(),
    ].join('\n'),
  };
}

export function expiryReminderEmail(
  tenant: TenantRecord,
  kind: DocumentKind,
  holderName: string | null,
  expiresOn: string,
): OutgoingEmail {
  const label = DOCUMENT_KIND_LABELS[kind];
  return {
    to: tenant.ownerEmail,
    subject: `Stationkeeper: ${label} expires on ${expiresOn}`,
    body: [
      `${tenant.businessName}, a required document is close to its expiry date.`,
      '',
      `Document: ${label}${holderName ? ` for ${holderName}` : ''}`,
      `Expires on: ${expiresOn}`,
      '',
      'Upload a renewal from Documents to keep booking.',
      signature(),
    ].join('\n'),
  };
}

export function approvalEmail(
  tenant: TenantRecord,
  kind: DocumentKind,
  expiresOn: string,
): OutgoingEmail {
  const label = DOCUMENT_KIND_LABELS[kind];
  return {
    to: tenant.ownerEmail,
    subject: `Stationkeeper: ${label} approved`,
    body: [
      `${tenant.businessName}, your ${label.toLowerCase()} has been approved.`,
      '',
      `Valid through: ${expiresOn}`,
      signature(),
    ].join('\n'),
  };
}

export function rejectionEmail(
  tenant: TenantRecord,
  kind: DocumentKind,
  reason: string,
): OutgoingEmail {
  const label = DOCUMENT_KIND_LABELS[kind];
  return {
    to: tenant.ownerEmail,
    subject: `Stationkeeper: ${label} needs attention`,
    body: [
      `${tenant.businessName}, your ${label.toLowerCase()} was not accepted.`,
      '',
      `Reason: ${reason}`,
      '',
      'Upload a replacement from Documents.',
      signature(),
    ].join('\n'),
  };
}

export function invoiceNoticeEmail(tenant: TenantRecord, invoice: InvoiceRecord): OutgoingEmail {
  return {
    to: tenant.ownerEmail,
    subject: `Stationkeeper: invoice ${invoice.number} is ready`,
    body: [
      `${tenant.businessName}, invoice ${invoice.number} for ${invoice.period} is ready.`,
      '',
      ...invoice.lines.map((line) => `${line.description} — ${formatAmount(line.amountCents)}`),
      '',
      `Subtotal: ${formatAmount(invoice.subtotalCents)}`,
      `Sales tax (${invoice.taxRatePercent}%): ${formatAmount(invoice.taxCents)}`,
      `Total: ${formatAmount(invoice.totalCents)}`,
      signature(),
    ].join('\n'),
  };
}

export function receiptEmail(tenant: TenantRecord, invoice: InvoiceRecord): OutgoingEmail {
  return {
    to: tenant.ownerEmail,
    subject: `Stationkeeper: receipt for invoice ${invoice.number}`,
    body: [
      `${tenant.businessName}, we received your payment for invoice ${invoice.number}.`,
      '',
      `Amount paid: ${formatAmount(invoice.totalCents)}`,
      `Period: ${invoice.period}`,
      signature(),
    ].join('\n'),
  };
}
