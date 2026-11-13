import { formatDollars } from "../shared/money.js";
import { AGENCY, localDateAt, localTimeAt } from "./agency.js";
import { type BookingData, type SeatRow } from "./bookings.js";
import type { Message } from "./services/smtp.js";

const when = (ms: number): string => `${localDateAt(ms)} ${localTimeAt(ms)}`;

function subject(prefix: string, data: BookingData): string {
  const start = data.row.start_at.getTime();
  return `${prefix}: ${data.row.ref} on ${localDateAt(start)} at ${localTimeAt(start)}`;
}

const zoneLine = `Times are in ${AGENCY.timeZone}.`;

function interpreterFacts(data: BookingData): string[] {
  const { row } = data;
  return [
    `Reference: ${row.ref}`,
    `Setting: ${row.setting}`,
    `Title: ${row.title}`,
    `Location: ${row.location}`,
    `On-site contact: ${row.onsite_contact_name}, ${row.onsite_contact_phone}`,
    `Deaf consumer: ${row.consumer_name}`,
    `Start: ${when(row.start_at.getTime())}`,
    `End: ${when(row.end_at.getTime())}`,
  ];
}

function seatLines(data: BookingData, seat: SeatRow): string[] {
  const partner = data.seats.find((other) => other.seat !== seat.seat && other.interpreter_id !== null);
  return [
    `Your seat: ${seat.seat}`,
    ...(data.row.seat_count === 2 ? [`Co-interpreter: ${partner?.name ?? "not yet assigned"}`] : []),
    `Prep files: ${data.materials.length}`,
  ];
}

/** The confirmation an interpreter receives when given a seat. */
export function assignmentEmail(data: BookingData, seat: SeatRow, address: string): Message {
  return {
    to: address,
    subject: subject("Assignment confirmed", data),
    body: [...interpreterFacts(data), ...seatLines(data, seat), "", zoneLine].join("\n"),
  };
}

function holderLine(data: BookingData, seat: SeatRow): string {
  const codes = (data.credentials.get(seat.interpreter_id ?? "") ?? []).map((credential) => credential.code).join(", ");
  return `Seat ${seat.seat}: ${seat.name ?? ""} (${codes})`;
}

function requesterFacts(data: BookingData): string[] {
  const { row } = data;
  return [`Reference: ${row.ref}`, `Title: ${row.title}`, `Start: ${when(row.start_at.getTime())}`, `End: ${when(row.end_at.getTime())}`];
}

/** The confirmation the requester receives each time the booking becomes fully covered. */
export function coverageEmail(data: BookingData): Message {
  const holders = data.seats.filter((seat) => seat.interpreter_id !== null).map((seat) => holderLine(data, seat));
  return {
    to: data.row.requester_email,
    subject: subject("Booking covered", data),
    body: [...requesterFacts(data), "Interpreters:", ...holders, "", zoneLine].join("\n"),
  };
}

/** One cancellation notice for the requester and one for each seat holder at the moment of cancelling. */
export function cancellationEmails(data: BookingData, chargeCents: number | null): Message[] {
  const late = chargeCents !== null;
  const requesterNotice: Message = {
    to: data.row.requester_email,
    subject: subject("Booking cancelled", data),
    body: [
      ...requesterFacts(data),
      late ? `Late cancellation charge: ${formatDollars(chargeCents)}` : "No cancellation charge.",
      "",
      zoneLine,
    ].join("\n"),
  };
  const interpreterNotices = data.seats.flatMap((seat): Message[] =>
    seat.interpreter_id === null || seat.email === null
      ? []
      : [
          {
            to: seat.email,
            subject: subject("Booking cancelled", data),
            body: [...interpreterFacts(data), `Your seat: ${seat.seat}`, late ? "This was a late cancellation." : "This booking was cancelled.", "", zoneLine].join("\n"),
          },
        ],
  );
  return [requesterNotice, ...interpreterNotices];
}
