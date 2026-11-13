/**
 * The six emails. None ever carries the consumer's name, street address or notes.
 */
import { agencyDate, clockLabels, longDate } from "../shared/agencyTime.js";
import { config } from "./config.js";
import type { Email } from "./mail.js";
import { type RequestRecord, type SeatLabel, endsAt } from "./requestStore.js";
import type { Charge } from "./rules.js";
import { dollars } from "./rules.js";

const SETTING_LABEL = { medical: "Medical", education: "Education", legal: "Legal" } as const;

function schedule(record: RequestRecord): { monthDay: string; date: string; start: string; end: string; window: string } {
  const start = clockLabels(record.startsAt);
  const end = clockLabels(endsAt(record));
  return {
    monthDay: start.monthDay,
    date: `${start.weekday}, ${longDate(agencyDate(record.startsAt))}`,
    start: start.clock,
    end: end.clock,
    window: `${start.clock} to ${end.clock} ${end.zone}`,
  };
}

const SIGN_OFF = "\n-- \nCrosshand Relay, Crosshand Interpreting Collective";

export function openSeatEmail(to: string, record: RequestRecord, openSeats: number): Email {
  const when = schedule(record);
  const setting = SETTING_LABEL[record.setting];
  return {
    to,
    subject: `Open seat: ${setting}, ${record.requiredCredential}, ${when.monthDay}, ${when.start} to ${when.end}, ${record.city}`,
    body: [
      `An interpreting job needs ${openSeats === 1 ? "1 more interpreter" : `${openSeats} more interpreters`}.`,
      "",
      `Setting: ${setting}`,
      `Required credential: ${record.requiredCredential}`,
      `Date: ${when.date}`,
      `Time: ${when.window}`,
      `City: ${record.city}`,
      `Open seats: ${openSeats}`,
      "",
      `Claim a seat: ${config.publicUrl}/open-seats`,
      SIGN_OFF,
    ].join("\n"),
  };
}

export function seatWonEmail(
  to: string,
  record: RequestRecord,
  wonLabel: SeatLabel,
  teammate: { label: SeatLabel; name: string | null } | null,
): Email {
  const when = schedule(record);
  const team =
    teammate === null
      ? "This is a solo job."
      : teammate.name
        ? `Teammate: ${teammate.name} (Seat ${teammate.label})`
        : `Seat ${teammate.label} is still open.`;
  return {
    to,
    subject: `Seat ${wonLabel} confirmed: ${record.reference}, ${when.monthDay}`,
    body: [
      `Seat ${wonLabel} on ${record.reference} is confirmed.`,
      "",
      `Date: ${when.date}`,
      `Time: ${when.window}`,
      `City: ${record.city}`,
      team,
      "",
      `The consumer's details are in the job: ${config.publicUrl}/assignments`,
      SIGN_OFF,
    ].join("\n"),
  };
}

export function fullyStaffedEmail(
  to: string,
  record: RequestRecord,
  team: { label: SeatLabel; name: string; badges: string[] }[],
): Email {
  const when = schedule(record);
  return {
    to,
    subject: `Fully staffed: ${record.reference}, ${when.monthDay}`,
    body: [
      `${record.reference} on ${when.date}, ${when.window}, is fully staffed.`,
      "",
      ...team.map((seat) => `Seat ${seat.label}: ${seat.name} (${seat.badges.join(", ") || "no current credential"})`),
      SIGN_OFF,
    ].join("\n"),
  };
}

export function cancellationReceiptEmail(
  to: string,
  record: RequestRecord,
  kind: "early" | "late",
  feeCents: number,
  billableMinutes: number,
  seatsCharged: number,
): Email {
  const fee = dollars(feeCents);
  return {
    to,
    subject: `Cancelled: ${record.reference}, fee $${fee}`,
    body: [
      `${record.reference} is cancelled.`,
      "",
      `Cancellation: ${kind === "early" ? "early (free)" : "late"}`,
      `Fee: $${fee}`,
      `Billable minutes: ${billableMinutes}`,
      `Seats charged: ${seatsCharged}`,
      SIGN_OFF,
    ].join("\n"),
  };
}

export function assignmentCancelledEmail(to: string, record: RequestRecord): Email {
  const when = schedule(record);
  return {
    to,
    subject: `Assignment cancelled: ${record.reference}, ${when.monthDay}`,
    body: [
      `Your seat on ${record.reference} is cancelled. You are free for this time.`,
      "",
      `Date: ${when.date}`,
      `Time: ${when.window}`,
      SIGN_OFF,
    ].join("\n"),
  };
}

export function chargesEmail(to: string, record: RequestRecord, charge: Charge): Email {
  const amount = dollars(charge.amountCents);
  return {
    to,
    subject: `Charges for ${record.reference}: $${amount}`,
    body: [
      `${record.reference} is closed and charged to ${record.organisation.name}.`,
      "",
      `Amount: $${amount}`,
      `Billable minutes: ${charge.billableMinutes}`,
      `Seats: ${charge.seats}`,
      `Hourly rate: $${dollars(charge.hourlyRateCents)}`,
      SIGN_OFF,
    ].join("\n"),
  };
}
