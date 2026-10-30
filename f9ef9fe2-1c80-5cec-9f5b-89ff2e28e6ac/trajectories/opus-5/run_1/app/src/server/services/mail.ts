import type { Booking } from '../../shared/types.js';
import { formatHours, formatMoney } from '../../shared/format.js';
import { sendMessage } from './smtp.js';

async function send(to: string, subject: string, text: string): Promise<void> {
  await sendMessage(to, subject, text);
}

function bookingDetail(booking: Booking): string {
  const blocks = booking.blocks
    .map((block) => `  ${block.station}: ${block.start}–${block.end} (${block.hours} h)`)
    .join('\n');
  const lines = booking.lines
    .map(
      (line) =>
        `  ${line.station} · tier ${line.tier} · ${line.hours} h · ` +
        (line.paid_by === 'pack' ? 'pack hours' : formatMoney(line.amount_cents)),
    )
    .join('\n');
  return [
    `Booking ${booking.ref}`,
    `Date: ${booking.date}`,
    'Stations:',
    blocks,
    `Hours: ${booking.hours}`,
    'Lines:',
    lines,
    `Total: ${booking.total}`,
    `Pack hours used: ${formatHours(booking.pack_quarters)}`,
    `Cancellation window: ${booking.cancellation_window_hours} hours`,
  ].join('\n');
}

export async function sendConfirmation(
  to: string,
  kitchenName: string,
  booking: Booking,
): Promise<void> {
  await send(
    to,
    `Booking ${booking.ref} confirmed — ${kitchenName}`,
    [`${kitchenName} has confirmed your booking.`, '', bookingDetail(booking)].join('\n'),
  );
}

export async function sendSeriesConfirmation(
  to: string,
  kitchenName: string,
  bookings: Booking[],
  seriesTotalCents: number,
): Promise<void> {
  const first = bookings[0];
  const last = bookings[bookings.length - 1];
  await send(
    to,
    `Weekly series ${first.ref} to ${last.ref} confirmed — ${kitchenName}`,
    [
      `${kitchenName} has confirmed your weekly series of ${bookings.length} slots.`,
      '',
      ...bookings.map((booking) => `${bookingDetail(booking)}\n`),
      `Series total: ${formatMoney(seriesTotalCents)}`,
    ].join('\n'),
  );
}

export async function sendCancellationReceipt(
  to: string,
  booking: Booking,
  refund: { pack_quarters: number; amount_cents: number },
  inWindow: boolean,
): Promise<void> {
  await send(
    to,
    `Booking ${booking.ref} cancelled — ${formatHours(refund.pack_quarters)} pack hours refunded`,
    [
      inWindow
        ? `Booking ${booking.ref} was cancelled in window.`
        : `Booking ${booking.ref} was cancelled inside the ${booking.cancellation_window_hours}-hour window, so it is still charged.`,
      `Refunded: ${formatHours(refund.pack_quarters)} pack hours and ${formatMoney(refund.amount_cents)}.`,
      '',
      bookingDetail(booking),
    ].join('\n'),
  );
}

export async function sendExpiryReminder(
  to: string,
  label: string,
  business: string,
  expiresOn: string,
): Promise<void> {
  await send(
    to,
    `${label} for ${business} expires ${expiresOn}`,
    [
      `The ${label.toLowerCase()} on file for ${business} expires on ${expiresOn}.`,
      'Upload a current document so bookings stay open.',
    ].join('\n'),
  );
}
