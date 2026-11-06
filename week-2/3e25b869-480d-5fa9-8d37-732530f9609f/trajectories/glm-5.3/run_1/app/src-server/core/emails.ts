// Bilingual email content, one builder per notice kind. Only public identifiers
// appear: record numbers, batch codes, bar numbers, scent names, dates, times,
// amounts, rates and (in its own email) the one-time code.
import { formatMoney, formatRate, formatTaxCode } from "./format.js";
import type { Money, TaxLine } from "./money.js";
import { cadenceLabel, topicLabel, type Cadence, type ContactTopic } from "./catalog.js";

const NBSP = "\u00A0";

export interface NoticeContent {
  subjectEn: string;
  subjectFr: string;
  linesEn: string[];
  linesFr: string[];
}

function taxLines(locale: "en-CA" | "fr-CA", taxes: TaxLine[]): string[] {
  return taxes.map((tax) => {
    const code = formatTaxCode(tax.code, locale);
    const rate = formatRate(tax.rateLabel, locale);
    const amount = formatMoney(tax.amount.cents, locale);
    return locale === "fr-CA" ? `${code} (${rate})${NBSP}:${NBSP}${amount}` : `${code} (${rate}): ${amount}`;
  });
}

export function stepupCodeEmail(code: string, expiresLocalMinute: string): NoticeContent {
  const clock = expiresLocalMinute.split("T")[1] ?? "00:00";
  const [h, m] = clock.split(":").map((part) => String(Number(part)));
  return {
    subjectEn: `Your Pain de Lune code: ${code}`,
    subjectFr: `Votre code Pain de Lune${NBSP}:${NBSP}${code}`,
    linesEn: [
      `Your one-time code is ${code}.`,
      `It works once and expires at ${h}:${m} Toronto time.`,
      `If you didn't ask for it, ignore this email.`
    ],
    linesFr: [
      `Votre code à usage unique est ${code}.`,
      `Il ne sert qu'une fois et expire à ${h}${NBSP}h${NBSP}${m}, heure de Toronto.`,
      `Si vous ne l'avez pas demandé, ignorez ce courriel.`
    ]
  };
}

export interface OrderConfirmationInput {
  orderNumber: string;
  bars: { bar: number; batch: string; scentEn: string; scentFr: string; price: Money }[];
  subtotal: Money;
  shipping: Money;
  taxes: TaxLine[];
  total: Money;
  shipOn: string;
}

export function orderConfirmationEmail(input: OrderConfirmationInput): NoticeContent {
  const barLine = (bar: OrderConfirmationInput["bars"][number], locale: "en-CA" | "fr-CA") => {
    const scent = locale === "fr-CA" ? bar.scentFr : bar.scentEn;
    const price = formatMoney(bar.price.cents, locale);
    return locale === "fr-CA"
      ? `Pain ${bar.bar} · ${bar.batch} · ${scent}${NBSP}:${NBSP}${price}`
      : `Bar ${bar.bar} · ${bar.batch} · ${scent}: ${price}`;
  };
  return {
    subjectEn: `Order ${input.orderNumber} confirmed`,
    subjectFr: `Commande ${input.orderNumber} confirmée`,
    linesEn: [
      `Order: ${input.orderNumber}`,
      ...input.bars.map((bar) => barLine(bar, "en-CA")),
      `Subtotal: ${formatMoney(input.subtotal.cents, "en-CA")}`,
      `Shipping: ${formatMoney(input.shipping.cents, "en-CA")}`,
      ...taxLines("en-CA", input.taxes),
      `Total: ${formatMoney(input.total.cents, "en-CA")}`,
      `Ships on: ${input.shipOn}`
    ],
    linesFr: [
      `Commande${NBSP}:${NBSP}${input.orderNumber}`,
      ...input.bars.map((bar) => barLine(bar, "fr-CA")),
      `Sous-total${NBSP}:${NBSP}${formatMoney(input.subtotal.cents, "fr-CA")}`,
      `Livraison${NBSP}:${NBSP}${formatMoney(input.shipping.cents, "fr-CA")}`,
      ...taxLines("fr-CA", input.taxes),
      `Total${NBSP}:${NBSP}${formatMoney(input.total.cents, "fr-CA")}`,
      `Expédition le${NBSP}:${NBSP}${input.shipOn}`
    ]
  };
}

export interface SubscriptionStartedInput {
  number: string;
  scentEn: string;
  scentFr: string;
  cadence: Cadence;
  subtotal: Money;
  discount: Money;
  taxes: TaxLine[];
  total: Money;
  chargedToday: Money;
  nextBillDate: string;
}

export function subscriptionStartedEmail(input: SubscriptionStartedInput): NoticeContent {
  return {
    subjectEn: `Subscription ${input.number} started`,
    subjectFr: `Abonnement ${input.number} commencé`,
    linesEn: [
      `Subscription: ${input.number}`,
      `Trio: ${input.scentEn}`,
      `Cadence: ${cadenceLabel(input.cadence, "en-CA")}`,
      `Subtotal: ${formatMoney(input.subtotal.cents, "en-CA")}`,
      `Subscribe-and-save (12%): -${formatMoney(input.discount.cents, "en-CA")}`,
      ...taxLines("en-CA", input.taxes),
      `Total: ${formatMoney(input.total.cents, "en-CA")}`,
      `Charged today: ${formatMoney(input.chargedToday.cents, "en-CA")}`,
      `Next bill date: ${input.nextBillDate}`
    ],
    linesFr: [
      `Abonnement${NBSP}:${NBSP}${input.number}`,
      `Trio${NBSP}:${NBSP}${input.scentFr}`,
      `Fréquence${NBSP}:${NBSP}${cadenceLabel(input.cadence, "fr-CA")}`,
      `Sous-total${NBSP}:${NBSP}${formatMoney(input.subtotal.cents, "fr-CA")}`,
      `Abonnement-épargne (12${NBSP}%)${NBSP}:${NBSP}-${formatMoney(input.discount.cents, "fr-CA")}`,
      ...taxLines("fr-CA", input.taxes),
      `Total${NBSP}:${NBSP}${formatMoney(input.total.cents, "fr-CA")}`,
      `Prélevé aujourd'hui${NBSP}:${NBSP}${formatMoney(input.chargedToday.cents, "fr-CA")}`,
      `Prochaine date de facturation${NBSP}:${NBSP}${input.nextBillDate}`
    ]
  };
}

export interface RefundEmailInput {
  refundNumber: string;
  orderNumber: string;
  bars: { bar: number; batch: string; scentEn: string; scentFr: string }[];
  amount: Money;
}

export function refundEmail(input: RefundEmailInput): NoticeContent {
  const barLine = (bar: RefundEmailInput["bars"][number], locale: "en-CA" | "fr-CA") => {
    const scent = locale === "fr-CA" ? bar.scentFr : bar.scentEn;
    return locale === "fr-CA" ? `Pain ${bar.bar} · ${bar.batch} · ${scent}` : `Bar ${bar.bar} · ${bar.batch} · ${scent}`;
  };
  return {
    subjectEn: `Refund ${input.refundNumber} for order ${input.orderNumber}`,
    subjectFr: `Remboursement ${input.refundNumber} pour la commande ${input.orderNumber}`,
    linesEn: [
      `Refund: ${input.refundNumber}`,
      `Order: ${input.orderNumber}`,
      ...input.bars.map((bar) => barLine(bar, "en-CA")),
      `Refunded: ${formatMoney(input.amount.cents, "en-CA")}`,
      `It reaches your original payment method within 5 to 10 business days.`
    ],
    linesFr: [
      `Remboursement${NBSP}:${NBSP}${input.refundNumber}`,
      `Commande${NBSP}:${NBSP}${input.orderNumber}`,
      ...input.bars.map((bar) => barLine(bar, "fr-CA")),
      `Remboursé${NBSP}:${NBSP}${formatMoney(input.amount.cents, "fr-CA")}`,
      `Il apparaîtra sur votre moyen de paiement d'origine d'ici 5 à 10 jours ouvrables.`
    ]
  };
}

export interface CreditEmailInput {
  creditNumber: string;
  amount: Money;
}

export function creditEmail(input: CreditEmailInput): NoticeContent {
  return {
    subjectEn: `Credit ${input.creditNumber} added to your account`,
    subjectFr: `Crédit ${input.creditNumber} ajouté à votre compte`,
    linesEn: [
      `Credit: ${input.creditNumber}`,
      `Amount: ${formatMoney(input.amount.cents, "en-CA")}`,
      `It applies automatically to your next invoice.`
    ],
    linesFr: [
      `Crédit${NBSP}:${NBSP}${input.creditNumber}`,
      `Montant${NBSP}:${NBSP}${formatMoney(input.amount.cents, "fr-CA")}`,
      `Il s'applique automatiquement à votre prochaine facture.`
    ]
  };
}

export interface ContactReplyInput {
  reference: string;
  topic: ContactTopic;
  name: string;
}

export function contactReplyEmail(input: ContactReplyInput): NoticeContent {
  return {
    subjectEn: `We received your message ${input.reference}`,
    subjectFr: `Nous avons bien reçu votre message ${input.reference}`,
    linesEn: [
      `Reference: ${input.reference}`,
      `Topic: ${topicLabel(input.topic, "en-CA")}`,
      `Thanks, ${input.name}. We reply within two business days.`
    ],
    linesFr: [
      `Référence${NBSP}:${NBSP}${input.reference}`,
      `Sujet${NBSP}:${NBSP}${topicLabel(input.topic, "fr-CA")}`,
      `Merci, ${input.name}. Nous répondons dans deux jours ouvrables.`
    ]
  };
}
