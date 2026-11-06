// Every email the app sends (brief: Services, Mailpit table). Each names only its own owner's horse and amounts.
import { dollars } from "../../shared/money.js";
import type { OutgoingMail } from "./smtp.js";

const SIGN_OFF = "\n\nRasp & Rein\nTravelling farrier";

interface Recipient {
  to: string;
  name: string;
}

const hello = (name: string): string => `Hello ${name},\n\n`;

export function bookingConfirmedMail(input: Recipient & {
  horse: string;
  barn: string;
  date: string;
  slotTime: string;
  cutoff: string;
  depositCents: number;
}): OutgoingMail {
  const deposit = input.depositCents > 0 ? `Your ${dollars(input.depositCents)} deposit is held against this booking.\n\n` : "";
  return {
    to: input.to,
    subject: `Booked: ${input.horse} at ${input.barn} on ${input.date}`,
    body:
      hello(input.name) +
      `${input.horse} is booked at ${input.barn} on ${input.date} at ${input.slotTime}.\n\n` +
      deposit +
      `Cancel by ${input.cutoff}. If you cancel after the cutoff, ${input.horse} still carries a trip share for this day.` +
      SIGN_OFF,
  };
}

/** The deposit sentence from the Cancel dialog body (brief: Feedback states). */
function depositSentence(late: boolean, capturedCents: number): string {
  if (capturedCents <= 0) return "";
  return late
    ? ` Your ${dollars(capturedCents)} deposit is kept and set against the trip share.`
    : ` Your ${dollars(capturedCents)} deposit will be refunded.`;
}

export function bookingCancelledMail(input: Recipient & {
  horse: string;
  barn: string;
  date: string;
  tripShareApplies: boolean;
  capturedCents: number;
}): OutgoingMail {
  return {
    to: input.to,
    subject: `Cancelled: ${input.horse} at ${input.barn} on ${input.date}`,
    body:
      hello(input.name) +
      `The booking for ${input.horse} at ${input.barn} on ${input.date} is cancelled.\n\n` +
      (input.tripShareApplies ? "A trip share still applies." : "No trip share applies.") +
      depositSentence(input.tripShareApplies, input.capturedCents) +
      SIGN_OFF,
  };
}

export function excusedMail(input: Recipient & { horse: string; barn: string; date: string; capturedCents: number }): OutgoingMail {
  return {
    to: input.to,
    subject: `Excused: ${input.horse} at ${input.barn} on ${input.date}`,
    body:
      hello(input.name) +
      `${input.horse} is excused from ${input.barn} on ${input.date}.\n\n` +
      "No trip share applies." +
      depositSentence(false, input.capturedCents) +
      SIGN_OFF,
  };
}

export function offerMail(input: Recipient & { horse: string; barn: string; date: string; slotTime: string; holdEnd: string }): OutgoingMail {
  return {
    to: input.to,
    subject: `Slot offered: ${input.horse} at ${input.barn} on ${input.date}`,
    body:
      hello(input.name) +
      `A slot opened for ${input.horse} at ${input.barn} on ${input.date} at ${input.slotTime}. It is held for you now.\n\n` +
      `Hold ends at ${input.holdEnd}.\nConfirm it on the barn day page before then.` +
      SIGN_OFF,
  };
}

export function offerLapsedMail(input: Recipient & { horse: string; barn: string; date: string }): OutgoingMail {
  return {
    to: input.to,
    subject: `Slot offer lapsed: ${input.horse} at ${input.barn} on ${input.date}`,
    body:
      hello(input.name) +
      `A slot opened for ${input.horse} at ${input.barn} on ${input.date}, but the card on file was declined, ` +
      `so the offer passed to the next horse on the waitlist.` +
      SIGN_OFF,
  };
}

export function visitSummaryMail(input: Recipient & {
  horse: string;
  date: string;
  items: ReadonlyArray<{ description: string; amount_cents: number }>;
  totalCents: number;
  nextDue: string;
}): OutgoingMail {
  const lines = input.items.map((item) => `${item.description}: ${dollars(item.amount_cents)}`).join("\n");
  return {
    to: input.to,
    subject: `Visit summary: ${input.horse} on ${input.date}`,
    body:
      hello(input.name) +
      `Here is the summary of ${input.horse}'s visit on ${input.date}.\n\n${lines}\n\n` +
      `Invoice total ${dollars(input.totalCents)}\n` +
      `Next due ${input.nextDue}` +
      SIGN_OFF,
  };
}

export function dueReminderMail(input: Recipient & { horse: string; nextDue: string }): OutgoingMail {
  return {
    to: input.to,
    subject: `Due soon: ${input.horse} by ${input.nextDue}`,
    body: hello(input.name) + `${input.horse} is due for the farrier by ${input.nextDue}. Book a slot on a coming barn day.` + SIGN_OFF,
  };
}

export type DunningMailState = "past_due" | "retry_1" | "retry_2" | "blocked" | "cleared";

const DUNNING_SUBJECTS: Record<DunningMailState, string> = {
  past_due: "Payment failed",
  retry_1: "Second payment attempt failed",
  retry_2: "Third payment attempt failed",
  blocked: "Account on hold",
  cleared: "Payment received",
};

export function dunningMail(input: Recipient & {
  state: DunningMailState;
  horse: string;
  date: string;
  nextTry: string;
  balanceCents: number;
}): OutgoingMail {
  const detail: Record<DunningMailState, string> = {
    past_due: `The card payment for ${input.horse} on ${input.date} did not go through. We will try again on ${input.nextTry}.`,
    retry_1: `The second payment attempt for ${input.horse} on ${input.date} did not go through. We will try again on ${input.nextTry}.`,
    retry_2: `The third payment attempt for ${input.horse} on ${input.date} did not go through. We will try again on ${input.nextTry}.`,
    blocked: `The invoice for ${input.horse} on ${input.date} is still unpaid (${dollars(input.balanceCents)}). New bookings are on hold until this invoice is paid.`,
    cleared: `Thank you: the invoice for ${input.horse} on ${input.date} is paid.`,
  };
  return {
    to: input.to,
    subject: `${DUNNING_SUBJECTS[input.state]}: ${input.horse} on ${input.date}`,
    body: hello(input.name) + detail[input.state] + SIGN_OFF,
  };
}

export function outstandingAlertMail(input: Recipient & { thresholdCents: number; outstandingCents: number }): OutgoingMail {
  return {
    to: input.to,
    subject: `Outstanding balance over ${dollars(input.thresholdCents)}`,
    body:
      hello(input.name) +
      `Unpaid invoices now add up to ${dollars(input.outstandingCents)}, over the ${dollars(input.thresholdCents)} alert line.` +
      SIGN_OFF,
  };
}

export function vetLinkMail(input: Recipient & { horse: string; url: string; until: string }): OutgoingMail {
  return {
    to: input.to,
    subject: `Hoof comparison for ${input.horse}`,
    body:
      hello(input.name) +
      `Rasp & Rein has shared a read-only hoof comparison for ${input.horse}:\n\n${input.url}\n\n` +
      `This link works until ${input.until}.` +
      SIGN_OFF,
  };
}
