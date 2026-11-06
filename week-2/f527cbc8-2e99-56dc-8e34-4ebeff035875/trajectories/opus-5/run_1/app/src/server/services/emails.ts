import { dollars } from '../util.js';

/**
 * The published emails. Each names only its own owner, horse and amounts, and each
 * event sends exactly one message.
 */
export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface BookingContext {
  horseName: string;
  barnName: string;
  businessDate: string;
  slotTime: string;
  cutoff: string;
}

export function bookingConfirmedEmail(context: BookingContext): EmailTemplate {
  return {
    subject: `Booked: ${context.horseName} at ${context.barnName} on ${context.businessDate}`,
    body: [
      `${context.horseName} is booked at ${context.barnName} on ${context.businessDate}.`,
      `Slot ${context.slotTime}.`,
      `Cancel by ${context.cutoff}.`,
      'Cancelling after the cutoff keeps the trip share for this day.',
    ].join('\n'),
  };
}

export function cancellationEmail(
  context: BookingContext,
  late: boolean,
  depositOutcome: 'refund' | 'keep' | 'none',
  depositCents: number,
): EmailTemplate {
  const shareLine = late ? 'A trip share still applies.' : 'No trip share applies.';
  const depositLine =
    depositOutcome === 'refund'
      ? ` Your $${dollars(depositCents)} deposit will be refunded.`
      : depositOutcome === 'keep'
        ? ` Your $${dollars(depositCents)} deposit is kept and set against the trip share.`
        : '';
  return {
    subject: `Cancelled: ${context.horseName} at ${context.barnName} on ${context.businessDate}`,
    body: [
      `${context.horseName}'s booking at ${context.barnName} on ${context.businessDate} is cancelled.`,
      `${shareLine}${depositLine}`,
    ].join('\n'),
  };
}

export function excusedEmail(
  context: BookingContext,
  depositCents: number | null,
): EmailTemplate {
  const depositLine = depositCents === null ? '' : ` Your $${dollars(depositCents)} deposit will be refunded.`;
  return {
    subject: `Excused: ${context.horseName} at ${context.barnName} on ${context.businessDate}`,
    body: [
      `${context.horseName} was excused from the barn day at ${context.barnName} on ${context.businessDate}.`,
      `No trip share applies.${depositLine}`,
    ].join('\n'),
  };
}

export function waitlistOfferEmail(
  context: BookingContext,
  holdEnd: string,
  timeZone: string,
): EmailTemplate {
  return {
    subject: `Slot offered: ${context.horseName} at ${context.barnName} on ${context.businessDate}`,
    body: [
      `A slot opened for ${context.horseName} at ${context.barnName} on ${context.businessDate}.`,
      `Slot ${context.slotTime}.`,
      `Hold ends at ${holdEnd} (${timeZone}).`,
    ].join('\n'),
  };
}

export function offerLapsedEmail(context: BookingContext): EmailTemplate {
  return {
    subject: `Slot offer lapsed: ${context.horseName} at ${context.barnName} on ${context.businessDate}`,
    body: [
      `The slot offered for ${context.horseName} at ${context.barnName} on ${context.businessDate} is no longer held.`,
    ].join('\n'),
  };
}

export function visitSummaryEmail(
  horseName: string,
  businessDate: string,
  items: readonly { description: string; amount_cents: number }[],
  totalCents: number,
  nextDueDate: string | null,
): EmailTemplate {
  const lines = items.map((item) => {
    const amount = item.amount_cents < 0
      ? `-$${dollars(Math.abs(item.amount_cents))}`
      : `$${dollars(item.amount_cents)}`;
    return `${item.description}: ${amount}`;
  });
  return {
    subject: `Visit summary: ${horseName} on ${businessDate}`,
    body: [
      `Visit summary for ${horseName} on ${businessDate}.`,
      ...lines,
      `Invoice total $${dollars(totalCents)}`,
      nextDueDate === null ? 'Next due unknown' : `Next due ${nextDueDate}`,
    ].join('\n'),
  };
}

export function dueReminderEmail(horseName: string, nextDueDate: string): EmailTemplate {
  return {
    subject: `Due soon: ${horseName} by ${nextDueDate}`,
    body: [`${horseName} is due for a visit by ${nextDueDate}.`].join('\n'),
  };
}

export type DunningEmailState = 'past_due' | 'retry_1' | 'retry_2' | 'blocked' | 'cleared';

export function dunningEmail(
  state: DunningEmailState,
  horseName: string,
  businessDate: string,
  nextTry: string | null,
): EmailTemplate {
  switch (state) {
    case 'past_due':
      return {
        subject: `Payment failed: ${horseName} on ${businessDate}`,
        body: `The card payment for ${horseName} on ${businessDate} failed.\nWe will try again on ${nextTry}.`,
      };
    case 'retry_1':
      return {
        subject: `Second payment attempt failed: ${horseName} on ${businessDate}`,
        body: `The second card payment for ${horseName} on ${businessDate} failed.\nWe will try again on ${nextTry}.`,
      };
    case 'retry_2':
      return {
        subject: `Third payment attempt failed: ${horseName} on ${businessDate}`,
        body: `The third card payment for ${horseName} on ${businessDate} failed.\nWe will try again on ${nextTry}.`,
      };
    case 'blocked':
      return {
        subject: `Account on hold: ${horseName} on ${businessDate}`,
        body: `The invoice for ${horseName} on ${businessDate} is still unpaid.\nNew bookings are on hold until this invoice is paid.`,
      };
    case 'cleared':
      return {
        subject: `Payment received: ${horseName} on ${businessDate}`,
        body: `Thank you — the payment for ${horseName} on ${businessDate} has been received.`,
      };
  }
}

export function outstandingAlertEmail(thresholdCents: number): EmailTemplate {
  return {
    subject: `Outstanding balance over $${dollars(thresholdCents)}`,
    body: `Outstanding money owed to the practice has risen above $${dollars(thresholdCents)}.`,
  };
}

export function vetLinkEmail(
  horseName: string,
  url: string,
  expiryWall: string,
  timeZone: string,
): EmailTemplate {
  return {
    subject: `Hoof comparison for ${horseName}`,
    body: [
      `A hoof comparison for ${horseName} is ready to read.`,
      url,
      `This link works until ${expiryWall} (${timeZone}).`,
    ].join('\n'),
  };
}
