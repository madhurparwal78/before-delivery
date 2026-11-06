import { appBaseUrl } from './config.js';
import { formatIsoDateHuman, formatMoneyCents } from '../shared/format.js';
import type { OutboundMail } from './services/mail.js';
import type { BookingLine, OfficeId } from '../shared/types.js';

function link(path: string): string {
  return `${appBaseUrl()}${path}`;
}

export function invitationEmail(input: { recipient: string; name: string; token: string }): OutboundMail {
  return {
    recipient: input.recipient,
    subject: "You're invited to Rungboard",
    body: [
      `Hello ${input.name},`,
      '',
      'You have been invited to Rungboard, the booking and casting workspace of Vesper & Rowe Talent.',
      'Set your password here:',
      link(`/invite/${input.token}`),
      '',
      'Vesper & Rowe Talent',
    ].join('\n'),
  };
}

export function passwordResetEmail(input: { recipient: string; token: string }): OutboundMail {
  return {
    recipient: input.recipient,
    subject: 'Reset your Rungboard password',
    body: [
      'A password reset was requested for your Rungboard account.',
      'Choose a new password here:',
      link(`/reset/${input.token}`),
      '',
      'If you did not ask for this, nothing has changed.',
      '',
      'Vesper & Rowe Talent',
    ].join('\n'),
  };
}

const DESK_ADDRESSES: Record<OfficeId, string> = {
  toronto: 'toronto-desk@vesperrowe.example',
  vancouver: 'vancouver-desk@vesperrowe.example',
};

export function castRequestEmail(input: {
  office: OfficeId;
  reference: string;
  name: string;
  company: string;
  email: string;
  shootDate: string;
  brief: string;
  talentNames: string[];
}): OutboundMail {
  return {
    recipient: DESK_ADDRESSES[input.office],
    subject: `Cast request from ${input.company}: ${input.talentNames.length} talent`,
    body: [
      `Reference: ${input.reference}`,
      `From: ${input.name} (${input.company})`,
      `Reply to: ${input.email}`,
      `Shoot date: ${formatIsoDateHuman(input.shootDate)}`,
      `Talent: ${input.talentNames.join(', ')}`,
      '',
      'Brief:',
      input.brief,
    ].join('\n'),
  };
}

/** Carries the job and fee lines only; no private talent detail, no other client. */
export function bookingConfirmationEmail(input: {
  recipient: string;
  reference: string;
  jobTitle: string;
  date: string;
  talentNames: string[];
  lines: BookingLine[];
  totalCents: number;
  rateCardName: string;
  calendar: string;
}): OutboundMail {
  return {
    recipient: input.recipient,
    subject: `Booking confirmed: ${input.jobTitle} on ${formatIsoDateHuman(input.date)}`,
    body: [
      `Booking ${input.reference} is confirmed.`,
      '',
      `Job: ${input.jobTitle}`,
      `Day: ${formatIsoDateHuman(input.date)}`,
      `Talent: ${input.talentNames.join(', ')}`,
      '',
      'Fees:',
      ...input.lines.map((line) => `${line.label}: ${formatMoneyCents(line.amountCents)}`),
      `Total: ${formatMoneyCents(input.totalCents)}`,
      '',
      `Rate card: ${input.rateCardName}`,
      '',
      'Vesper & Rowe Talent',
    ].join('\n'),
    attachment: { name: `booking-${input.reference}.ics`, content: input.calendar },
  };
}

export type ChallengeOutcome = 'now_first' | 'released' | 'confirmed' | 'day_booked';

const OUTCOME_SENTENCES: Record<ChallengeOutcome, string> = {
  now_first: 'Your option is now 1st.',
  released: 'Your 1st option was released.',
  confirmed: 'Your 1st option is confirmed.',
  day_booked: 'This day is now booked.',
};

/** States only the recipient's own result and never names the other client. */
export function challengeOutcomeEmail(input: {
  recipient: string;
  talentName: string;
  date: string;
  outcome: ChallengeOutcome;
  dedupeKey: string;
  talentId: string;
}): OutboundMail {
  return {
    recipient: input.recipient,
    subject: `Option update: ${input.talentName} on ${formatIsoDateHuman(input.date)}`,
    body: [
      `There is news about your option on ${input.talentName} for ${formatIsoDateHuman(input.date)}.`,
      '',
      OUTCOME_SENTENCES[input.outcome],
      '',
      'Vesper & Rowe Talent',
    ].join('\n'),
    dedupeKey: input.dedupeKey,
    talentIds: [input.talentId],
  };
}

export function packageLinkEmail(input: {
  recipient: string;
  recipientName: string;
  title: string;
  token: string;
}): OutboundMail {
  return {
    recipient: input.recipient,
    subject: `Casting package: ${input.title}`,
    body: [
      `Hello ${input.recipientName},`,
      '',
      `Here is the casting package "${input.title}" from Vesper & Rowe Talent:`,
      link(`/p/${input.token}`),
      '',
      'You can shortlist or pass on each talent and download the photos.',
      '',
      'Vesper & Rowe Talent',
    ].join('\n'),
  };
}

export function guardianConsentEmail(input: {
  recipient: string;
  guardianName: string;
  firstName: string;
  token: string;
}): OutboundMail {
  return {
    recipient: input.recipient,
    subject: `Consent needed for ${input.firstName}'s application to Vesper & Rowe`,
    body: [
      `Hello ${input.guardianName},`,
      '',
      `${input.firstName} has applied to Vesper & Rowe Talent. Because they are under 18, we need your consent before a scout reviews the application.`,
      'Approve or decline here:',
      link(`/consent/${input.token}`),
      '',
      'The link can be used once.',
      '',
      'Vesper & Rowe Talent',
    ].join('\n'),
  };
}

export function licenceReminderEmail(input: {
  recipient: string;
  talentName: string;
  endsOn: string;
  media: string;
  territory: string;
  dedupeKey: string;
  talentId: string;
}): OutboundMail {
  return {
    recipient: input.recipient,
    subject: `Usage licence ending ${formatIsoDateHuman(input.endsOn)}: ${input.talentName}`,
    body: [
      `The usage licence for ${input.talentName} (${input.media}, ${input.territory}) ends on ${formatIsoDateHuman(input.endsOn)}.`,
      '',
      'Reply to this email to renew it.',
      '',
      'Vesper & Rowe Talent',
    ].join('\n'),
    dedupeKey: input.dedupeKey,
    talentIds: [input.talentId],
  };
}
