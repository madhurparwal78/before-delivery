import type { Locale } from '../../shared/money.ts';
import { cadenceLabelKey, fareLabelKey, tierLabelKey, type Cadence, type Fare, type Tier } from '../../shared/domain.ts';
import { t } from '../../shared/strings.ts';
import { env } from '../env.ts';
import type { OutboxMessage } from './outbox.ts';

export function appLink(locale: Locale, path: string): string {
  return `${env.publicUrl}/${locale}${path}`;
}

export type BookingEmailData = {
  ref: string;
  locale: Locale;
  email: string;
  film_title: string;
  date: string;
  time: string;
  auditorium_name: string;
  auditorium_code: string;
  seats: string[];
  tickets: Array<{ code: string; seat: string; fare: Fare }>;
  admission_cents: number;
  gst_cents: number;
  qst_cents: number;
  uplift_cents: number;
  credit_applied_cents: number;
  total_cents: number;
  paid_cents: number;
  payers: Array<{ name: string; share_cents: number }>;
  link: string;
  guest: boolean;
};

export function bookingConfirmationEmail(data: BookingEmailData): OutboxMessage {
  const locale = data.locale;
  const lines = [
    t('mail_booking_ref', locale, { ref: data.ref }),
    t('mail_film', locale, { film: data.film_title }),
    t('mail_showtime', locale, { date: data.date, time: data.time }),
    t('mail_venue', locale, { name: data.auditorium_name, code: data.auditorium_code }),
    t('mail_seats', locale, { seats: data.seats.join(', ') }),
    ...data.tickets.map((ticket) =>
      t('mail_ticket', locale, {
        code: ticket.code,
        seat: ticket.seat,
        fare: t(fareLabelKey(ticket.fare), locale),
      }),
    ),
    t('mail_admission', locale, { amount_cents: data.admission_cents }),
    t('mail_gst', locale, { amount_cents: data.gst_cents }),
    t('mail_qst', locale, { amount_cents: data.qst_cents }),
  ];
  if (data.uplift_cents > 0) lines.push(t('mail_uplift', locale, { amount_cents: data.uplift_cents }));
  if (data.credit_applied_cents > 0) lines.push(t('mail_credit', locale, { amount_cents: data.credit_applied_cents }));
  lines.push(t('mail_total', locale, { amount_cents: data.total_cents }));
  lines.push(t('mail_paid_today', locale, { amount_cents: data.paid_cents }));
  for (const payer of data.payers) {
    lines.push(t('mail_share', locale, { name: payer.name, amount_cents: payer.share_cents }));
  }
  lines.push(t(data.guest ? 'mail_manage' : 'mail_view', locale, { link: data.link }));
  return {
    key: `booking-confirmed:${data.ref}`,
    kind: 'booking-confirmed',
    to: data.email,
    subject: t('subj_booking_confirmed', locale, { ref: data.ref }),
    lines,
    locale,
  };
}

export function bookingLinkEmail(input: {
  ref: string;
  email: string;
  locale: Locale;
  token: string;
  sequence: number;
}): OutboxMessage {
  return {
    key: `booking-link:${input.ref}:${input.sequence}`,
    kind: 'booking-link',
    to: input.email,
    subject: t('subj_booking_link', input.locale, { ref: input.ref }),
    lines: [t('mail_manage', input.locale, { link: appLink(input.locale, `/b/${input.token}`) })],
    locale: input.locale,
  };
}

export type RefundReason = { kind: 'patron' } | { kind: 'boxoffice' } | { kind: 'season'; title: string };

export function refundEmail(input: {
  ref: string;
  email: string;
  locale: Locale;
  refunded_cents: number;
  recredited_cents: number;
  reason: RefundReason;
}): OutboxMessage {
  const locale = input.locale;
  const reasonText =
    input.reason.kind === 'patron'
      ? t('mail_reason_patron', locale)
      : input.reason.kind === 'boxoffice'
        ? t('mail_reason_boxoffice', locale)
        : t('mail_reason_season', locale, { title: input.reason.title });
  const lines = [t('mail_refund_card', locale, { amount_cents: input.refunded_cents })];
  if (input.recredited_cents > 0) {
    lines.push(t('mail_refund_credit', locale, { amount_cents: input.recredited_cents }));
  }
  lines.push(t('mail_reason', locale, { reason: reasonText }));
  return {
    key: `booking-refunded:${input.ref}`,
    kind: 'booking-refunded',
    to: input.email,
    subject: t('subj_refund', locale, { ref: input.ref }),
    lines,
    locale,
  };
}

export function membershipStartedEmail(input: {
  account_number: string;
  email: string;
  locale: Locale;
  tier: Tier;
  cadence: Cadence | 'gift';
  amount_cents: number;
  next_date: string;
  sequence: number;
}): OutboxMessage {
  const locale = input.locale;
  return {
    key: `membership-started:${input.account_number}:${input.sequence}`,
    kind: 'membership-started',
    to: input.email,
    subject: t('subj_membership_started', locale),
    lines: [
      t('mail_member_number', locale, { number: input.account_number }),
      t('mail_tier', locale, { tier: t(tierLabelKey(input.tier), locale) }),
      t('mail_billing', locale, { cadence: t(cadenceLabelKey(input.cadence), locale) }),
      t('mail_amount_charged', locale, { amount_cents: input.amount_cents }),
      input.cadence === 'gift'
        ? t('mail_ends_on', locale, { date: input.next_date })
        : t('mail_next_billing', locale, { date: input.next_date }),
    ],
    locale,
  };
}

export function membershipChangedEmail(input: {
  account_number: string;
  email: string;
  locale: Locale;
  from: { tier: Tier; cadence: Cadence | 'gift' };
  to: { tier: Tier; cadence: Cadence | 'gift' };
  effective_date: string;
  amount_cents: number;
  sequence: number;
}): OutboxMessage {
  const locale = input.locale;
  return {
    key: `membership-changed:${input.account_number}:${input.sequence}`,
    kind: 'membership-changed',
    to: input.email,
    subject: t('subj_membership_changed', locale),
    lines: [
      t('mail_from_tier', locale, {
        tier: t(tierLabelKey(input.from.tier), locale),
        cadence: t(cadenceLabelKey(input.from.cadence), locale),
      }),
      t('mail_to_tier', locale, {
        tier: t(tierLabelKey(input.to.tier), locale),
        cadence: t(cadenceLabelKey(input.to.cadence), locale),
      }),
      t('mail_takes_effect', locale, { date: input.effective_date }),
      t('mail_prorated', locale, { amount_cents: input.amount_cents }),
    ],
    locale,
  };
}

export function giftReceiptEmail(input: {
  ref: string;
  email: string;
  locale: Locale;
  tier: Tier;
  recipient_name: string;
  amount_cents: number;
}): OutboxMessage {
  const locale = input.locale;
  return {
    key: `gift-receipt:${input.ref}`,
    kind: 'gift-receipt',
    to: input.email,
    subject: t('subj_gift_receipt', locale, { ref: input.ref }),
    lines: [
      t('mail_gift_ref', locale, { ref: input.ref }),
      t('mail_tier', locale, { tier: t(tierLabelKey(input.tier), locale) }),
      t('mail_recipient', locale, { name: input.recipient_name }),
      t('mail_amount_charged', locale, { amount_cents: input.amount_cents }),
    ],
    locale,
  };
}

export function giftDeliveredEmail(input: {
  ref: string;
  email: string;
  locale: Locale;
  tier: Tier;
  purchaser_name: string;
  message: string;
  token: string;
}): OutboxMessage {
  const locale = input.locale;
  const lines = [t('mail_tier', locale, { tier: t(tierLabelKey(input.tier), locale) })];
  if (input.message.trim() !== '') lines.push(t('mail_message', locale, { message: input.message }));
  lines.push(t('mail_redeem', locale, { link: appLink(locale, `/gift/${input.token}`) }));
  return {
    key: `gift-delivered:${input.ref}`,
    kind: 'gift-delivered',
    to: input.email,
    subject: t('subj_gift_delivered', locale, { name: input.purchaser_name }),
    lines,
    locale,
  };
}

export function stepupCodeEmail(input: {
  account_number: string;
  email: string;
  locale: Locale;
  code: string;
  minutes: number;
  sequence: number;
}): OutboxMessage {
  const locale = input.locale;
  return {
    key: `stepup-code:${input.account_number}:${input.sequence}`,
    kind: 'stepup-code',
    to: input.email,
    subject: t('subj_stepup', locale),
    lines: [t('mail_code', locale, { code: input.code }), t('mail_code_expires', locale, { minutes: input.minutes })],
    locale,
  };
}

export function enquiryReplyEmail(input: {
  ref: string;
  email: string;
  locale: Locale;
  subject: string;
  body: string;
  sequence: number;
}): OutboxMessage {
  const locale = input.locale;
  return {
    key: `enquiry-reply:${input.ref}:${input.sequence}`,
    kind: 'enquiry-reply',
    to: input.email,
    subject: t('subj_enquiry_reply', locale, { subject: input.subject, ref: input.ref }),
    lines: [...input.body.split('\n'), t('mail_enquiry_ref', locale, { ref: input.ref }), t('mail_signature', locale)],
    locale,
  };
}
