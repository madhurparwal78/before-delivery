import { type BookingRow, DOCUMENT_LABELS, type DocumentType, type Kitchen, type Member, type Station } from "./domain.js";
import type { Message } from "./mail.js";
import { dollars, hoursText } from "./money.js";
import { blocksOf } from "./views.js";

// The four emails of the brief, each addressed to one recipient and holding only that member's details.

function bookingDetails(booking: BookingRow, stations: Station[]): string[] {
  return [
    `Booking ${booking.ref} — ${booking.date} (kitchen time)`,
    ...blocksOf(booking.cells, stations).map((b) => `  ${b.station}: ${b.start}–${b.end}, ${b.hours} h`),
    `  Hours: ${hoursText(booking.quarters)}`,
    ...booking.lines.map(
      (l) => `  ${l.station} · tier ${l.tier} · ${l.hours} h · ${l.paid_by === "pack" ? "pack" : dollars(l.amount_cents)}`,
    ),
    `  Pack hours used: ${hoursText(booking.pack_quarters)}`,
    `  Total: ${dollars(booking.total_cents)}`,
    `  Cancellation window: ${booking.cancellation_window_hours} hours before the start`,
  ];
}

export function confirmationEmail(kitchen: Kitchen, member: Member, bookings: BookingRow[], stations: Station[]): Message {
  const first = bookings[0];
  const last = bookings.at(-1);
  if (!first || !last) throw new Error("A confirmation needs a booking");
  const series = bookings.length > 1;
  const subject = series
    ? `Weekly series ${first.ref} to ${last.ref} confirmed — ${kitchen.name}`
    : `Booking ${first.ref} confirmed — ${kitchen.name}`;
  const intro = series
    ? `Your weekly series of ${bookings.length} bookings at ${kitchen.name} is confirmed.`
    : `Your booking at ${kitchen.name} is confirmed.`;
  const total = bookings.reduce((sum, b) => sum + b.total_cents, 0);
  const text = [
    `Hello ${member.business},`,
    "",
    intro,
    "",
    ...bookings.flatMap((b) => [...bookingDetails(b, stations), ""]),
    ...(series ? [`Series total: ${dollars(total)}`, ""] : []),
    `Times are ${kitchen.timezone} kitchen time.`,
    "Pilotlight",
  ].join("\n");
  return { to: member.contact_email, subject, text };
}

export function cancellationEmail(
  kitchen: Kitchen,
  member: Member,
  booking: BookingRow,
  inWindow: boolean,
  refundCents: number,
  refundQuarters: number,
): Message {
  const outcome = inWindow
    ? `It was cancelled in window, so ${hoursText(refundQuarters)} pack hours and ${dollars(refundCents)} are refunded.`
    : `It was cancelled late, inside the ${booking.cancellation_window_hours}-hour cancellation window, so it is still charged and nothing is refunded.`;
  return {
    to: member.contact_email,
    subject: `Booking ${booking.ref} cancelled — ${hoursText(refundQuarters)} pack hours refunded`,
    text: [
      `Hello ${member.business},`,
      "",
      `Booking ${booking.ref} on ${booking.date} at ${kitchen.name} is cancelled.`,
      outcome,
      `Refunded amount: ${dollars(refundCents)}`,
      "",
      "Pilotlight",
    ].join("\n"),
  };
}

export function reminderEmail(to: string, business: string, type: DocumentType, expiresOn: string, kitchen: Kitchen): Message {
  const label = DOCUMENT_LABELS[type];
  return {
    to,
    subject: `${label} for ${business} expires ${expiresOn}`,
    text: [
      `${label} for ${business} at ${kitchen.name} expires ${expiresOn}.`,
      "Upload a current document on the Papers screen so bookings after that date stay covered.",
      "",
      "Pilotlight",
    ].join("\n"),
  };
}
