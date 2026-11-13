import { formatMoney } from '../shared/money.js';
import type { BookingRow, BookingUnitRow } from '../domain/bookings.js';

export interface MailMessage {
  subject: string;
  body: string;
}

export function confirmationMail(row: BookingRow, units: BookingUnitRow[]): MailMessage {
  const lines = [
    ...units.map((unit) => `${unit.serial} · ${unit.className}`),
    `Pickup ${row.pickupDate} · Return ${row.returnDate}`,
    `Billable days: ${row.billableDays}`,
    `Day rate: ${formatMoney(row.dayRateCents)}`,
    `Hire: ${formatMoney(row.hirePriceCents)}`,
    `Deposit: ${formatMoney(row.depositCents)}`,
    `Charged: ${formatMoney(row.totalCents)}`,
    `Rate card: v${row.rateCardVersion}`,
  ];
  return {
    subject: `Booking confirmed · ${row.ref} · ${row.kitName}`,
    body: `${lines.join('\n')}\n`,
  };
}

export function certificateRejectedMail(ref: string, reason: string): MailMessage {
  return {
    subject: `Certificate not accepted · ${ref}`,
    body: `Your certificate of insurance for booking ${ref} was not accepted.\nReason: ${reason}\n`,
  };
}

export function returnReceiptMail(
  row: BookingRow,
  units: BookingUnitRow[],
  damageCents: number,
  refundCents: number,
): MailMessage {
  const lines = [
    ...units.map((unit) =>
      unit.condition === 'damaged'
        ? `${unit.serial} · Damaged · ${formatMoney(unit.damageChargeCents)}`
        : `${unit.serial} · OK`,
    ),
    `Damage charge: ${formatMoney(damageCents)}`,
    `Deposit refunded: ${formatMoney(refundCents)}`,
  ];
  return { subject: `Return receipt · ${row.ref}`, body: `${lines.join('\n')}\n` };
}
