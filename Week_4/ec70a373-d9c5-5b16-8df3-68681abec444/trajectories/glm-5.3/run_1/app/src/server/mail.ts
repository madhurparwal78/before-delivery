import type { DbClient, Row } from './db.js';
import { clientQuery } from './db.js';
import { nowMs } from '../clock.js';

export type MailEvent =
  | { kind: 'booking_confirmed'; to: string; station: string; date: string; start: string; end: string; site: string; reference: string; hours: number; availableAfter: number }
  | { kind: 'series_booked'; to: string; station: string; weekday: string; start: string; end: string; weeks: number; dates: string[]; totalHours: number }
  | { kind: 'booking_cancelled'; to: string; station: string; date: string; start: string; end: string; refunded: number; forfeited: number; staffLine?: string }
  | { kind: 'pack_receipt'; to: string; packName: string; hours: number; price: string; purchaseId: string; validThrough: string; availableAfter: number }
  | { kind: 'expiry_notice'; to: string; typeLabel: string; date: string; noticeKind: '14-day' | '3-day' }
  | { kind: 'inspector_link'; to: string; truckName: string; siteName: string; url: string; expiresLocal: string };

function formatHours(qh: number): string {
  return (qh / 4).toFixed(2);
}

/** The published subject and plain-text body for each event. */
function compose(event: MailEvent): { subject: string; body: string } {
  switch (event.kind) {
    case 'booking_confirmed':
      return {
        subject: `Booking confirmed: ${event.station}, ${event.date} ${event.start}-${event.end}`,
        body: [
          `Site: ${event.site}`,
          `Reference: ${event.reference}`,
          `Hours: ${formatHours(event.hours)}`,
          `Available pack hours after: ${formatHours(event.availableAfter)}`,
        ].join('\n'),
      };
    case 'series_booked':
      return {
        subject: `Weekly booking confirmed: ${event.station}, ${event.weekday}s ${event.start}-${event.end}, ${event.weeks} weeks`,
        body: [
          `Occurrences: ${event.dates.join(', ')}`,
          `Total hours: ${formatHours(event.totalHours)}`,
        ].join('\n'),
      };
    case 'booking_cancelled':
      return {
        subject: `Booking cancelled: ${event.station}, ${event.date} ${event.start}-${event.end}`,
        body: [
          `Refunded pack hours: ${formatHours(event.refunded)}`,
          `Forfeited pack hours: ${formatHours(event.forfeited)}`,
          ...(event.staffLine ? [event.staffLine] : []),
        ].join('\n'),
      };
    case 'pack_receipt':
      return {
        subject: `Receipt: ${event.packName} (${formatHours(event.hours)} pack hours)`,
        body: [
          `Amount: ${event.price}`,
          `Purchase id: ${event.purchaseId}`,
          `Valid through ${event.validThrough}`,
          `Available pack hours after: ${formatHours(event.availableAfter)}`,
        ].join('\n'),
      };
    case 'expiry_notice':
      return {
        subject: `${event.typeLabel} expires ${event.date} (${event.noticeKind} notice)`,
        body: [
          `Your ${event.typeLabel.toLowerCase()} is valid through ${event.date}.`,
          `Upload a renewed document before it expires.`,
        ].join('\n'),
      };
    case 'inspector_link':
      return {
        subject: `Commissary visit log: ${event.truckName}`,
        body: [
          `Truck: ${event.truckName}`,
          `Commissary: ${event.siteName}`,
          `Link: ${event.url}`,
          `Works until ${event.expiresLocal}.`,
        ].join('\n'),
      };
  }
}

/** One message per event, written to the outbox in the same transaction as its event. */
export async function queueMail(client: DbClient, tenantId: string, event: MailEvent): Promise<void> {
  const { subject, body } = compose(event);
  await clientQuery(
    client,
    `INSERT INTO email_outbox (tenant_id, to_email, subject, body, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, event.to, subject, body, nowMs()],
  );
}

export interface OutboxRow extends Row {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}
