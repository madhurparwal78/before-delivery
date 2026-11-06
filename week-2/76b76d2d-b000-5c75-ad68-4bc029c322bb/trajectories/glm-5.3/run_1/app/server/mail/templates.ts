import type { Locale, Tier, Cadence, Fare } from '../domain/model';
import {
  formatAmount, fareLabel, tierLabel, cadenceLabel,
} from '../domain/i18n';

export interface EmailLink { path: string }

function dt(date: string, time: string): string {
  return `${date} ${time}`;
}

/** The email templates: every line comes from the published table. */
export interface BookingConfirmationData {
  bookingRef: string;
  filmTitle: string;
  date: string;
  time: string;
  auditoriumName: string;
  auditoriumCode: string;
  seats: string[];
  tickets: { code: string; seat: string; fare: Fare }[];
  admissionCents: number;
  gstCents: number;
  qstCents: number;
  upliftCents: number;
  creditAppliedCents: number;
  totalCents: number;
  paidCents: number;
  split: { name: string; share_cents: number }[] | null;
  guestLink: string | null;
  accountBookingLink: string | null;
}

export function bookingConfirmationEmail(locale: Locale, d: BookingConfirmationData): {
  subject: string; lines: string[];
} {
  const L = locale === 'en';
  const subject = L ? `Booking confirmed — ${d.bookingRef}` : `Réservation confirmée — ${d.bookingRef}`;
  const lines: string[] = [
    L ? `Booking reference: ${d.bookingRef}` : `Référence de réservation : ${d.bookingRef}`,
    L ? `Film: ${d.filmTitle}` : `Film : ${d.filmTitle}`,
    L ? `Showtime: ${dt(d.date, d.time)}` : `Séance : ${dt(d.date, d.time)}`,
    L ? `Venue: ${d.auditoriumName} (${d.auditoriumCode})` : `Salle : ${d.auditoriumName} (${d.auditoriumCode})`,
    L ? `Seats: ${d.seats.join(', ')}` : `Places : ${d.seats.join(', ')}`,
  ];
  for (const t of d.tickets) {
    lines.push(L
      ? `Ticket ${t.code} — Seat ${t.seat} — ${fareLabel(t.fare, locale)}`
      : `Billet ${t.code} — Place ${t.seat} — ${fareLabel(t.fare, locale)}`);
  }
  lines.push(L ? `Admission: ${formatAmount(d.admissionCents, locale)}` : `Entrée : ${formatAmount(d.admissionCents, locale)}`);
  lines.push(L ? `GST (5%): ${formatAmount(d.gstCents, locale)}` : `TPS (5 %) : ${formatAmount(d.gstCents, locale)}`);
  lines.push(L ? `QST (9.975%): ${formatAmount(d.qstCents, locale)}` : `TVQ (9,975 %) : ${formatAmount(d.qstCents, locale)}`);
  if (d.upliftCents > 0) {
    lines.push(L
      ? `Supporter uplift (not taxed): ${formatAmount(d.upliftCents, locale)}`
      : `Contribution de soutien (non taxable) : ${formatAmount(d.upliftCents, locale)}`);
  }
  if (d.creditAppliedCents > 0) {
    lines.push(L ? `Credit applied: ${formatAmount(d.creditAppliedCents, locale)}` : `Crédit appliqué : ${formatAmount(d.creditAppliedCents, locale)}`);
  }
  lines.push(L ? `Total: ${formatAmount(d.totalCents, locale)}` : `Total : ${formatAmount(d.totalCents, locale)}`);
  lines.push(L ? `Paid today: ${formatAmount(d.paidCents, locale)}` : `Payé aujourd'hui : ${formatAmount(d.paidCents, locale)}`);
  if (d.split) {
    for (const p of d.split) {
      lines.push(L ? `Share — ${p.name}: ${formatAmount(p.share_cents, locale)}` : `Part — ${p.name} : ${formatAmount(p.share_cents, locale)}`);
    }
  }
  const link = d.guestLink ?? d.accountBookingLink;
  if (link) {
    lines.push(L ? `Manage your booking: ${link}` : `Gérer votre réservation : ${link}`);
  }
  return { subject, lines };
}

export function bookingLinkEmail(locale: Locale, bookingRef: string, link: string): { subject: string; lines: string[] } {
  const L = locale === 'en';
  return {
    subject: L ? `Your Halide booking link — ${bookingRef}` : `Votre lien de réservation Halide — ${bookingRef}`,
    lines: [L ? `Manage your booking: ${link}` : `Gérer votre réservation : ${link}`],
  };
}

export function refundEmail(locale: Locale, bookingRef: string, refundedCents: number, recreditedCents: number, reason: 'self' | 'box-office' | { seasonTitle: string }): { subject: string; lines: string[] } {
  const L = locale === 'en';
  const subject = L ? `Refund issued — ${bookingRef}` : `Remboursement émis — ${bookingRef}`;
  const lines = [
    L ? `Refunded to your card: ${formatAmount(refundedCents, locale)}` : `Remboursé sur votre carte : ${formatAmount(refundedCents, locale)}`,
  ];
  if (recreditedCents > 0) {
    lines.push(L ? `Returned to your credit: ${formatAmount(recreditedCents, locale)}` : `Remis en crédit : ${formatAmount(recreditedCents, locale)}`);
  }
  if (reason === 'self') {
    lines.push(L ? 'Reason: Requested by you' : 'Motif : À votre demande');
  } else if (reason === 'box-office') {
    lines.push(L ? 'Reason: Issued by the box office' : 'Motif : Émis par la billetterie');
  } else {
    lines.push(L ? `Reason: Season withdrawn: ${reason.seasonTitle}` : `Motif : Saison retirée : ${reason.seasonTitle}`);
  }
  return { subject, lines };
}

export function membershipStartedEmail(locale: Locale, d: {
  accountNumber: string; tier: Tier; cadence: Cadence | 'gift'; amountCents: number;
  nextDate: string;
}): { subject: string; lines: string[] } {
  const L = locale === 'en';
  const subject = L ? 'Your Halide membership has started' : 'Votre adhésion Halide a commencé';
  const lines = [
    L ? `Member number: ${d.accountNumber}` : `Numéro de membre : ${d.accountNumber}`,
    L ? `Tier: ${tierLabel(d.tier, locale)}` : `Palier : ${tierLabel(d.tier, locale)}`,
    d.cadence === 'gift'
      ? (L ? `Billing: Gift, 12 months` : `Facturation : Cadeau, 12 mois`)
      : (L ? `Billing: ${cadenceLabel(d.cadence, locale)}` : `Facturation : ${cadenceLabel(d.cadence, locale)}`),
    L ? `Amount charged: ${formatAmount(d.amountCents, locale)}` : `Montant facturé : ${formatAmount(d.amountCents, locale)}`,
    d.cadence === 'gift'
      ? (L ? `Ends on: ${d.nextDate}` : `Prend fin le : ${d.nextDate}`)
      : (L ? `Next billing date: ${d.nextDate}` : `Prochaine facturation : ${d.nextDate}`),
  ];
  return { subject, lines };
}

export function membershipChangedEmail(locale: Locale, d: {
  fromTier: Tier; fromCadence: Cadence | 'gift';
  toTier: Tier; toCadence: Cadence | 'gift';
  effectiveDate: string; chargeCents: number;
}): { subject: string; lines: string[] } {
  const L = locale === 'en';
  const subject = L ? 'Your Halide membership has changed' : 'Votre adhésion Halide a été modifiée';
  const lines = [
    L ? `From: ${tierLabel(d.fromTier, locale)}, ${cadenceLabel(d.fromCadence, locale)}` : `Avant : ${tierLabel(d.fromTier, locale)}, ${cadenceLabel(d.fromCadence, locale)}`,
    L ? `To: ${tierLabel(d.toTier, locale)}, ${cadenceLabel(d.toCadence, locale)}` : `Après : ${tierLabel(d.toTier, locale)}, ${cadenceLabel(d.toCadence, locale)}`,
    L ? `Takes effect: ${d.effectiveDate}` : `Prend effet : ${d.effectiveDate}`,
    L ? `Prorated charge today: ${formatAmount(d.chargeCents, locale)}` : `Montant au prorata aujourd'hui : ${formatAmount(d.chargeCents, locale)}`,
  ];
  return { subject, lines };
}

export function giftReceiptEmail(locale: Locale, d: {
  giftRef: string; tier: Tier; recipientName: string; amountCents: number;
}): { subject: string; lines: string[] } {
  const L = locale === 'en';
  const subject = L ? `Gift membership receipt — ${d.giftRef}` : `Reçu d'adhésion-cadeau — ${d.giftRef}`;
  return {
    subject,
    lines: [
      L ? `Gift reference: ${d.giftRef}` : `Référence du cadeau : ${d.giftRef}`,
      L ? `Tier: ${tierLabel(d.tier, locale)}` : `Palier : ${tierLabel(d.tier, locale)}`,
      L ? `Recipient: ${d.recipientName}` : `Destinataire : ${d.recipientName}`,
      L ? `Amount charged: ${formatAmount(d.amountCents, locale)}` : `Montant facturé : ${formatAmount(d.amountCents, locale)}`,
    ],
  };
}

export function giftDeliveredEmail(locale: Locale, d: {
  purchaserName: string; tier: Tier; message: string; link: string;
}): { subject: string; lines: string[] } {
  const L = locale === 'en';
  const subject = L
    ? `${d.purchaserName} has given you a Halide membership`
    : `${d.purchaserName} vous offre une adhésion Halide`;
  const lines = [
    L ? `Tier: ${tierLabel(d.tier, locale)}` : `Palier : ${tierLabel(d.tier, locale)}`,
  ];
  if (d.message) {
    lines.push(L ? `Message: ${d.message}` : `Message : ${d.message}`);
  }
  lines.push(L ? `Redeem your membership: ${d.link}` : `Activez votre adhésion : ${d.link}`);
  return { subject, lines };
}

export function stepupCodeEmail(locale: Locale, code: string, minutes: number): { subject: string; lines: string[] } {
  const L = locale === 'en';
  const subject = L ? 'Your Halide verification code' : 'Votre code de vérification Halide';
  return {
    subject,
    lines: [
      L ? `Code: ${code}` : `Code : ${code}`,
      L ? `This code expires in ${minutes} min.` : `Ce code expire dans ${minutes} min.`,
    ],
  };
}

export function enquiryReplyEmail(locale: Locale, ref: string, subject: string, body: string): { subject: string; lines: string[] } {
  const L = locale === 'en';
  return {
    subject: L ? `Re: ${subject} [${ref}]` : `Re : ${subject} [${ref}]`,
    lines: [
      body,
      L ? `Enquiry reference: ${ref}` : `Référence de la demande : ${ref}`,
      L ? '— Halide Film Society box office' : '— Billetterie de la Société du film Halide',
    ],
  };
}

/** Every email body as plain text: one published line per line. */
export function emailText(lines: string[]): string {
  return lines.join('\r\n');
}

/** The HTML part mirrors the text content. */
export function emailHtml(lines: string[]): string {
  const escaped = lines.map(l => l
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;'));
  return `<!doctype html><html><body><pre style="font-family:monospace;white-space:pre-wrap">${escaped.join('<br>')}</pre></body></html>`;
}
