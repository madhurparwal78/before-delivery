import { CADENCE_LABELS, CONTACT_TOPIC_LABELS, scentName } from '../../shared/catalog.js';
import { formatMoney, NBSP, taxCodeLabel, formatRate } from '../../shared/money.js';
import { pad, torontoParts } from '../../shared/toronto.js';
import type {
  Cadence,
  ContactTopic,
  Locale,
  Money,
  OrderLine,
  TaxLine,
} from '../../shared/types.js';

export const LOCALE_SEPARATOR = '----------';

type Block = { subject: string; lines: string[] };

export type MailTemplate = { subject: string; body: string };

function other(locale: Locale): Locale {
  return locale === 'fr-CA' ? 'en-CA' : 'fr-CA';
}

function render(locale: Locale, block: (locale: Locale) => Block): MailTemplate {
  const primary = block(locale);
  const secondary = block(other(locale));
  return {
    subject: primary.subject,
    body: [...primary.lines, LOCALE_SEPARATOR, ...secondary.lines].join('\n'),
  };
}

function label(locale: Locale, en: string, fr: string): string {
  return locale === 'fr-CA' ? `${fr}${NBSP}:` : `${en}:`;
}

function amount(value: Money, locale: Locale): string {
  return formatMoney(value, locale);
}

function taxLines(taxes: readonly TaxLine[], locale: Locale): string[] {
  return taxes.map(
    (line) =>
      `${taxCodeLabel(line.code, locale)} (${formatRate(line.rate, locale)})${locale === 'fr-CA' ? NBSP : ''}: ${amount(line.amount, locale)}`,
  );
}

function clockTime(instant: Date, locale: Locale): string {
  const parts = torontoParts(instant);
  const minute = pad(parts.minute, 2);
  return locale === 'fr-CA' ? `${parts.hour} h ${minute}` : `${parts.hour}:${minute}`;
}

export function stepUpCodeMail(code: string, expiresAt: Date, locale: Locale): MailTemplate {
  return render(locale, (l) => ({
    subject:
      l === 'fr-CA' ? `Votre code Pain de Lune${NBSP}: ${code}` : `Your Pain de Lune code: ${code}`,
    lines:
      l === 'fr-CA'
        ? [
            `Votre code à usage unique est ${code}.`,
            `Il ne sert qu'une fois et expire à ${clockTime(expiresAt, l)}, heure de Toronto.`,
            "Si vous ne l'avez pas demandé, ignorez ce courriel.",
          ]
        : [
            `Your one-time code is ${code}.`,
            `It works once and expires at ${clockTime(expiresAt, l)} Toronto time.`,
            "If you didn't ask for it, ignore this email.",
          ],
  }));
}

export function maskCodeSubject(subject: string): string {
  return subject.replace(/\d{6}/, '\u2022\u2022\u2022\u2022\u2022\u2022');
}

export function orderConfirmationMail(
  order: {
    number: string;
    lines: readonly OrderLine[];
    subtotal: Money;
    shipping_fee: Money;
    taxes: readonly TaxLine[];
    total: Money;
    ship_on: string;
  },
  locale: Locale,
): MailTemplate {
  return render(locale, (l) => ({
    subject:
      l === 'fr-CA' ? `Commande ${order.number} confirmée` : `Order ${order.number} confirmed`,
    lines: [
      `${label(l, 'Order', 'Commande')} ${order.number}`,
      ...order.lines.map(
        (line) =>
          `${l === 'fr-CA' ? 'Pain' : 'Bar'} ${line.bar} \u00B7 ${line.batch} \u00B7 ${scentName(line.scent, l)}${l === 'fr-CA' ? NBSP : ''}: ${amount(line.unit_price, l)}`,
      ),
      `${label(l, 'Subtotal', 'Sous-total')} ${amount(order.subtotal, l)}`,
      `${label(l, 'Shipping', 'Livraison')} ${amount(order.shipping_fee, l)}`,
      ...taxLines(order.taxes, l),
      `${label(l, 'Total', 'Total')} ${amount(order.total, l)}`,
      `${label(l, 'Ships on', 'Expédition le')} ${order.ship_on}`,
    ],
  }));
}

export function subscriptionStartedMail(
  subscription: {
    number: string;
    scent: string;
    cadence: Cadence;
    subtotal: Money;
    discount: Money;
    taxes: readonly TaxLine[];
    total: Money;
    chargedToday: Money;
    nextBillDate: string;
  },
  locale: Locale,
): MailTemplate {
  return render(locale, (l) => ({
    subject:
      l === 'fr-CA'
        ? `Abonnement ${subscription.number} commencé`
        : `Subscription ${subscription.number} started`,
    lines: [
      `${label(l, 'Subscription', 'Abonnement')} ${subscription.number}`,
      `${label(l, 'Trio', 'Trio')} ${scentName(subscription.scent, l)}`,
      `${label(l, 'Cadence', 'Fréquence')} ${CADENCE_LABELS[subscription.cadence][l]}`,
      `${label(l, 'Subtotal', 'Sous-total')} ${amount(subscription.subtotal, l)}`,
      `${
        l === 'fr-CA'
          ? `Abonnement-épargne (12${NBSP}%)${NBSP}:`
          : 'Subscribe-and-save (12%):'
      } -${amount(subscription.discount, l)}`,
      ...taxLines(subscription.taxes, l),
      `${label(l, 'Total', 'Total')} ${amount(subscription.total, l)}`,
      `${label(l, 'Charged today', "Prélevé aujourd'hui")} ${amount(subscription.chargedToday, l)}`,
      `${label(l, 'Next bill date', 'Prochaine date de facturation')} ${subscription.nextBillDate}`,
    ],
  }));
}

export function refundMail(
  refund: {
    number: string;
    order: string;
    bars: readonly { batch: string; bar: number; scent: string }[];
    amount: Money;
  },
  locale: Locale,
): MailTemplate {
  return render(locale, (l) => ({
    subject:
      l === 'fr-CA'
        ? `Remboursement ${refund.number} pour la commande ${refund.order}`
        : `Refund ${refund.number} for order ${refund.order}`,
    lines: [
      `${label(l, 'Refund', 'Remboursement')} ${refund.number}`,
      `${label(l, 'Order', 'Commande')} ${refund.order}`,
      ...refund.bars.map(
        (bar) =>
          `${l === 'fr-CA' ? 'Pain' : 'Bar'} ${bar.bar} \u00B7 ${bar.batch} \u00B7 ${scentName(bar.scent, l)}`,
      ),
      `${label(l, 'Refunded', 'Remboursé')} ${amount(refund.amount, l)}`,
      l === 'fr-CA'
        ? "Il apparaîtra sur votre moyen de paiement d'origine d'ici 5 à 10 jours ouvrables."
        : 'It reaches your original payment method within 5 to 10 business days.',
    ],
  }));
}

export function creditMail(
  credit: { number: string; amount: Money },
  locale: Locale,
): MailTemplate {
  return render(locale, (l) => ({
    subject:
      l === 'fr-CA'
        ? `Crédit ${credit.number} ajouté à votre compte`
        : `Credit ${credit.number} added to your account`,
    lines: [
      `${label(l, 'Credit', 'Crédit')} ${credit.number}`,
      `${label(l, 'Amount', 'Montant')} ${amount(credit.amount, l)}`,
      l === 'fr-CA'
        ? "Il s'applique automatiquement à votre prochaine facture."
        : 'It applies automatically to your next invoice.',
    ],
  }));
}

export function contactReplyMail(
  contact: { number: string; topic: ContactTopic; name: string },
  locale: Locale,
): MailTemplate {
  return render(locale, (l) => ({
    subject:
      l === 'fr-CA'
        ? `Nous avons bien reçu votre message ${contact.number}`
        : `We received your message ${contact.number}`,
    lines: [
      `${label(l, 'Reference', 'Référence')} ${contact.number}`,
      `${label(l, 'Topic', 'Sujet')} ${CONTACT_TOPIC_LABELS[contact.topic][l]}`,
      l === 'fr-CA'
        ? `Merci, ${contact.name}. Nous répondons en deux jours ouvrables.`
        : `Thanks, ${contact.name}. We reply within two business days.`,
    ],
  }));
}
