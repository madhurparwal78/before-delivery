import { CADENCE_LABELS, FARE_LABELS, formatMoney, TIER_LABELS, type Cadence, type Fare, type Locale, type Tier } from "../shared/domain.ts";
import { config } from "./config.ts";
import { torontoDate, torontoTime } from "./time.ts";

type Email = { subject: string; text: string };

/** `<label> : <value>` in French, `<label>: <value>` in English. */
const line = (locale: Locale, en: string, fr: string, value: string): string => (locale === "en" ? `${en}: ${value}` : `${fr} : ${value}`);
const link = (path: string): string => `${config.publicUrl}${path}`;

type ConfirmationInput = {
  locale: Locale; ref: string; filmTitle: string; startsAt: Date; auditoriumName: string; auditoriumCode: string; seats: string[];
  tickets: { code: string; seat: string; fare: Fare }[]; admission: number; gst: number; qst: number; uplift: number; creditApplied: number;
  total: number; paid: number; split: { name: string; share_cents: number }[] | null; guestToken: string | null;
};

export function bookingConfirmation(b: ConfirmationInput): Email {
  const l = b.locale;
  const money = (cents: number): string => formatMoney(cents, l);
  const lines = [
    line(l, "Booking reference", "Référence de réservation", b.ref),
    line(l, "Film", "Film", b.filmTitle),
    line(l, "Showtime", "Séance", `${torontoDate(b.startsAt)} ${torontoTime(b.startsAt)}`),
    line(l, "Venue", "Salle", `${b.auditoriumName} (${b.auditoriumCode})`),
    line(l, "Seats", "Places", b.seats.join(", ")),
    ...b.tickets.map((t) => (l === "en" ? `Ticket ${t.code} — Seat ${t.seat} — ${FARE_LABELS[t.fare].en}` : `Billet ${t.code} — Place ${t.seat} — ${FARE_LABELS[t.fare].fr}`)),
    line(l, "Admission", "Entrée", money(b.admission)),
    line(l, "GST (5%)", "TPS (5 %)", money(b.gst)),
    line(l, "QST (9.975%)", "TVQ (9,975 %)", money(b.qst)),
  ];
  if (b.uplift) lines.push(line(l, "Supporter uplift (not taxed)", "Contribution de soutien (non taxable)", money(b.uplift)));
  if (b.creditApplied) lines.push(line(l, "Credit applied", "Crédit appliqué", money(b.creditApplied)));
  lines.push(line(l, "Total", "Total", money(b.total)), line(l, "Paid today", "Payé aujourd'hui", money(b.paid)));
  for (const payer of b.split ?? []) lines.push(l === "en" ? `Share — ${payer.name}: ${money(payer.share_cents)}` : `Part — ${payer.name} : ${money(payer.share_cents)}`);
  lines.push(b.guestToken
    ? line(l, "Manage your booking", "Gérer votre réservation", link(`/${l}/b/${b.guestToken}`))
    : line(l, "View your booking", "Voir votre réservation", link(`/${l}/account/bookings/${b.ref}`)));
  return { subject: l === "en" ? `Booking confirmed — ${b.ref}` : `Réservation confirmée — ${b.ref}`, text: lines.join("\n") };
}

export function bookingLink(locale: Locale, ref: string, token: string): Email {
  return {
    subject: locale === "en" ? `Your Halide booking link — ${ref}` : `Votre lien de réservation Halide — ${ref}`,
    text: line(locale, "Manage your booking", "Gérer votre réservation", link(`/${locale}/b/${token}`)),
  };
}

export type RefundReason = { kind: "patron" } | { kind: "box-office" } | { kind: "season"; title: Record<Locale, string> };

export function bookingRefunded(locale: Locale, ref: string, refunded: number, recredited: number, reason: RefundReason): Email {
  const why = reason.kind === "patron" ? (locale === "en" ? "Requested by you" : "À votre demande")
    : reason.kind === "box-office" ? (locale === "en" ? "Issued by the box office" : "Émis par la billetterie")
    : locale === "en" ? `Season withdrawn: ${reason.title.en}` : `Saison retirée : ${reason.title.fr}`;
  const lines = [line(locale, "Refunded to your card", "Remboursé sur votre carte", formatMoney(refunded, locale))];
  if (recredited) lines.push(line(locale, "Returned to your credit", "Remis en crédit", formatMoney(recredited, locale)));
  lines.push(line(locale, "Reason", "Motif", why));
  return { subject: locale === "en" ? `Refund issued — ${ref}` : `Remboursement émis — ${ref}`, text: lines.join("\n") };
}

const cadenceLabel = (cadence: Cadence | "gift", locale: Locale): string =>
  cadence === "gift" ? (locale === "en" ? "Gift, 12 months" : "Cadeau, 12 mois") : CADENCE_LABELS[cadence][locale];

export function membershipStarted(locale: Locale, input: { number: string; tier: Tier; cadence: Cadence | "gift"; charged: number; nextDate: string }): Email {
  const gift = input.cadence === "gift";
  return {
    subject: locale === "en" ? "Your Halide membership has started" : "Votre adhésion Halide a commencé",
    text: [
      line(locale, "Member number", "Numéro de membre", input.number),
      line(locale, "Tier", "Palier", TIER_LABELS[input.tier][locale]),
      line(locale, "Billing", "Facturation", cadenceLabel(input.cadence, locale)),
      line(locale, "Amount charged", "Montant facturé", formatMoney(input.charged, locale)),
      gift ? line(locale, "Ends on", "Prend fin le", input.nextDate) : line(locale, "Next billing date", "Prochaine facturation", input.nextDate),
    ].join("\n"),
  };
}

export function membershipChanged(locale: Locale, input: { from: [Tier, Cadence]; to: [Tier, Cadence]; effectiveDate: string; charged: number }): Email {
  const plan = ([tier, cadence]: [Tier, Cadence]): string => `${TIER_LABELS[tier][locale]}, ${CADENCE_LABELS[cadence][locale]}`;
  return {
    subject: locale === "en" ? "Your Halide membership has changed" : "Votre adhésion Halide a été modifiée",
    text: [
      line(locale, "From", "Avant", plan(input.from)),
      line(locale, "To", "Après", plan(input.to)),
      line(locale, "Takes effect", "Prend effet", input.effectiveDate),
      line(locale, "Prorated charge today", "Montant au prorata aujourd'hui", formatMoney(input.charged, locale)),
    ].join("\n"),
  };
}

export function giftReceipt(locale: Locale, input: { ref: string; tier: Tier; recipientName: string; charged: number }): Email {
  return {
    subject: locale === "en" ? `Gift membership receipt — ${input.ref}` : `Reçu d'adhésion-cadeau — ${input.ref}`,
    text: [
      line(locale, "Gift reference", "Référence du cadeau", input.ref),
      line(locale, "Tier", "Palier", TIER_LABELS[input.tier][locale]),
      line(locale, "Recipient", "Destinataire", input.recipientName),
      line(locale, "Amount charged", "Montant facturé", formatMoney(input.charged, locale)),
    ].join("\n"),
  };
}

export function giftDelivered(locale: Locale, input: { purchaserName: string; tier: Tier; message: string; token: string }): Email {
  const lines = [line(locale, "Tier", "Palier", TIER_LABELS[input.tier][locale])];
  if (input.message) lines.push(line(locale, "Message", "Message", input.message));
  lines.push(line(locale, "Redeem your membership", "Activez votre adhésion", link(`/${locale}/gift/${input.token}`)));
  return {
    subject: locale === "en" ? `${input.purchaserName} has given you a Halide membership` : `${input.purchaserName} vous offre une adhésion Halide`,
    text: lines.join("\n"),
  };
}

export function stepupCode(locale: Locale, code: string, minutes: number): Email {
  return {
    subject: locale === "en" ? "Your Halide verification code" : "Votre code de vérification Halide",
    text: [line(locale, "Code", "Code", code), locale === "en" ? `This code expires in ${minutes} min.` : `Ce code expire dans ${minutes} min.`].join("\n"),
  };
}

export function enquiryReply(locale: Locale, input: { ref: string; subject: string; body: string }): Email {
  return {
    subject: locale === "en" ? `Re: ${input.subject} [${input.ref}]` : `Re : ${input.subject} [${input.ref}]`,
    text: [
      input.body,
      "",
      line(locale, "Enquiry reference", "Référence de la demande", input.ref),
      locale === "en" ? "— Halide Film Society box office" : "— Billetterie de la Société du film Halide",
    ].join("\n"),
  };
}
