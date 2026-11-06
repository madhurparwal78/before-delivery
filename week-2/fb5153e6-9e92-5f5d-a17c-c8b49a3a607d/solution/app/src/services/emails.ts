import { config } from '../config.js';
import type { Locale } from '../shared/locale.js';
import { formatAmount, formatDate } from '../shared/locale.js';
import { editionCopyLine, refundedLine, totalLine } from '../shared/strings.js';
import { licenceLabel } from '../shared/labels.js';
import type { LicenceType } from '../domain/money.js';
import type { PlanName } from '../domain/plans.js';
import { PLANS } from '../domain/plans.js';
import { enqueueMail } from './outbox.js';

function receiptUrl(receiptToken: string): string {
  return `${config.publicUrl}/receipts/${receiptToken}`;
}

/** One receipt email, in the checkout locale, after Kill Bill confirms. */
export async function sendReceiptEmail(order: {
  readonly orderRef: string;
  readonly receiptToken: string;
  readonly email: string;
  readonly locale: Locale;
  readonly licence: LicenceType;
  readonly amountCents: number;
  readonly editionNumber: number | null;
  readonly editionTotal: number | null;
}): Promise<void> {
  const { locale } = order;
  const subject =
    locale === 'de'
      ? `Deine Turnstone Studio Quittung ${order.orderRef}`
      : `Your Turnstone Studio receipt ${order.orderRef}`;
  const lines = [
    totalLine(formatAmount(order.amountCents, locale), locale),
    licenceLabel(order.licence, locale),
  ];
  if (order.editionNumber !== null && order.editionTotal !== null) {
    lines.push(editionCopyLine(order.editionNumber, order.editionTotal, locale));
  }
  lines.push(receiptUrl(order.receiptToken));
  await enqueueMail(`receipt:${order.orderRef}`, order.email, subject, lines.join('\n'));
}

/** One refund email per refund, after Kill Bill confirms. */
export async function sendRefundEmail(
  orderRef: string,
  email: string,
  locale: Locale,
  refundCents: number,
  refundSequence: number,
): Promise<void> {
  const subject =
    locale === 'de' ? `Erstattung für ${orderRef}` : `Refund for ${orderRef}`;
  const body = refundedLine(formatAmount(refundCents, locale), locale);
  await enqueueMail(`refund:${orderRef}:${refundSequence}`, email, subject, body);
}

/** Plan-change notices go to the author in English. */
export async function sendDowngradeEmail(
  email: string,
  target: PlanName,
  effectiveDate: string,
): Promise<void> {
  const label = PLANS[target].label;
  const date = formatDate(effectiveDate, 'en');
  await enqueueMail(
    `plan-downgrade:${target}:${effectiveDate}:${new Date().toISOString()}`,
    email,
    `Your plan changes to ${label} on ${date}`,
    `Your plan changes to ${label} on ${date}.`,
  );
}

export async function sendUpgradeEmail(
  email: string,
  target: PlanName,
  chargedCents: number,
  stamp: string,
): Promise<void> {
  const label = PLANS[target].label;
  await enqueueMail(
    `plan-upgrade:${target}:${stamp}`,
    email,
    `Your plan is now ${label}`,
    `Charged today ${formatAmount(chargedCents, 'en')}`,
  );
}
