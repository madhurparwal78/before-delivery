import { formatCents } from '../../shared/money.js';
import { formatLongDate } from '../../shared/time.js';
import type { MailToQueue } from '../db/outbox.js';
import type { OrderRecord, RefundRecord } from '../db/orders.js';
import type { SubscriptionRecord } from '../db/subscriptions.js';
import { env } from '../env.js';
import { lineRows, receiptRows, refundSplitRows, shipToLines } from './receipt.js';

function table(rows: ReadonlyArray<{ label: string; value: string }>): string {
  const width = Math.max(...rows.map((row) => row.label.length)) + 2;
  return rows.map((row) => `  ${row.label.padEnd(width)}${row.value}`).join('\n');
}

function invoiceUrl(orderNumber: string): string {
  return `${env.app.publicUrl}/api/orders/${orderNumber}/invoice.pdf`;
}

function orderBody(order: OrderRecord, opening: string): string {
  return [
    opening,
    '',
    'Your cans',
    table(lineRows(order)),
    '',
    'Totals',
    table(receiptRows(order)),
    '',
    'Shipping to',
    shipToLines(order)
      .map((line) => `  ${line}`)
      .join('\n'),
    '',
    `Invoice: ${invoiceUrl(order.number)}`,
    '',
    'Ceibo',
  ].join('\n');
}

export function orderConfirmationMail(order: OrderRecord): MailToQueue {
  return ({
    dedupeKey: `order-confirmed:${order.number}`,
    to: order.customer_email,
    subject: `Your Ceibo order ${order.number} is confirmed`,
    body: orderBody(
      order,
      `Thanks ${order.customer_name}. Order ${order.number} is confirmed and we are packing it now.`,
    ),
  });
}

export function receiptCopyMail(order: OrderRecord): MailToQueue {
  return ({
    dedupeKey: `receipt-copy:${order.number}:${Date.now()}`,
    to: order.customer_email,
    subject: `Your Ceibo order ${order.number} receipt (copy)`,
    body: orderBody(order, `Here is another copy of your receipt for order ${order.number}.`),
  });
}

export function renewalPaidMail(order: OrderRecord): MailToQueue {
  return ({
    dedupeKey: `renewal-paid:${order.number}`,
    to: order.customer_email,
    subject: `Your Ceibo box renewed: order ${order.number}`,
    body: orderBody(order, `Your Ceibo box renewed. Order ${order.number} is on its way.`),
  });
}

export function upcomingRenewalMail(
  subscription: SubscriptionRecord,
  renewalDate: string,
): MailToQueue {
  const date = formatLongDate(renewalDate);
  return ({
    dedupeKey: `upcoming-renewal:${subscription.id}:${renewalDate}`,
    to: subscription.customer_email,
    subject: `Your next Ceibo box renews on ${date}`,
    body: [
      `Your next Ceibo box renews on ${date}.`,
      '',
      'To pause, skip, swap flavours or cancel, open your subscription page:',
      `${env.app.publicUrl}/account/subscriptions/${subscription.id}`,
      '',
      'Ceibo',
    ].join('\n'),
  });
}

export function refundAppliedMail(
  order: OrderRecord,
  refund: RefundRecord,
): MailToQueue {
  const amount = `$${formatCents(refund.amount_cents)}`;
  return ({
    dedupeKey: `refund-applied:${refund.id}`,
    to: order.customer_email,
    subject: `Refund of ${amount} for order ${order.number}`,
    body: [
      `We have refunded ${amount} on order ${order.number}.`,
      '',
      'How the refund splits',
      table(refundSplitRows(order, refund.split)),
      '',
      `Refunded so far: $${formatCents(order.refunded_cents)} of $${formatCents(order.total_cents)}`,
      '',
      'Ceibo',
    ].join('\n'),
  });
}

export function pauseAppliedMail(
  subscription: SubscriptionRecord,
  from: string,
  resumes: string,
): MailToQueue {
  return ({
    dedupeKey: `sub-pause:${subscription.id}:${from}`,
    to: subscription.customer_email,
    subject: 'Your Ceibo subscription is paused',
    body: [
      `Your Ceibo subscription is paused from ${formatLongDate(from)} and resumes on ${formatLongDate(resumes)}.`,
      '',
      'Ceibo',
    ].join('\n'),
  });
}

export function skipAppliedMail(
  subscription: SubscriptionRecord,
  date: string,
): MailToQueue {
  return ({
    dedupeKey: `sub-skip:${subscription.id}:${date}`,
    to: subscription.customer_email,
    subject: 'Your next Ceibo box is skipped',
    body: [
      `Your box due on ${formatLongDate(date)} is skipped. The one after it will come as usual.`,
      '',
      'Ceibo',
    ].join('\n'),
  });
}

export function swapAppliedMail(
  subscription: SubscriptionRecord,
  planLabel: string,
  date: string,
): MailToQueue {
  return ({
    dedupeKey: `sub-swap:${subscription.id}:${date}:${planLabel}`,
    to: subscription.customer_email,
    subject: `Your Ceibo box is now ${planLabel}`,
    body: [
      `From ${formatLongDate(date)} your Ceibo box is the ${planLabel}.`,
      '',
      'Ceibo',
    ].join('\n'),
  });
}

export function cancelAppliedMail(
  subscription: SubscriptionRecord,
  endDate: string,
): MailToQueue {
  return ({
    dedupeKey: `sub-cancel:${subscription.id}:${endDate}`,
    to: subscription.customer_email,
    subject: `Your Ceibo subscription will end on ${formatLongDate(endDate)}`,
    body: [
      `Your Ceibo subscription will end on ${formatLongDate(endDate)}. Nothing more will be charged.`,
      '',
      'Ceibo',
    ].join('\n'),
  });
}

const cardPage = (subscriptionId: string) =>
  `${env.app.publicUrl}/account/subscriptions/${subscriptionId}/card`;

export function dunningFailureMail(subscription: SubscriptionRecord): MailToQueue {
  return ({
    dedupeKey: `dunning:${subscription.id}:failed`,
    to: subscription.customer_email,
    subject: "Your Ceibo renewal didn't go through",
    body: [
      "Your renewal payment didn't go through. Update your card to keep your boxes coming:",
      cardPage(subscription.id),
      '',
      'Ceibo',
    ].join('\n'),
  });
}

export function dunningRetryMail(
  subscription: SubscriptionRecord,
  retry: 1 | 2 | 3,
  runId: string,
): MailToQueue {
  return ({
    dedupeKey: `dunning:${runId}:retry_${retry}`,
    to: subscription.customer_email,
    subject: `Ceibo payment retry ${retry} of 3 didn't go through`,
    body: [
      `We tried your card again and it was declined. Update your card to keep your boxes coming:`,
      cardPage(subscription.id),
      '',
      'Ceibo',
    ].join('\n'),
  });
}

export function dunningHoldMail(
  subscription: SubscriptionRecord,
  runId: string,
): MailToQueue {
  return ({
    dedupeKey: `dunning:${runId}:held`,
    to: subscription.customer_email,
    subject: 'Your Ceibo deliveries are on hold',
    body: [
      "Your deliveries are on hold because we couldn't take payment. Update your card to restart them:",
      cardPage(subscription.id),
      '',
      'Ceibo',
    ].join('\n'),
  });
}

export function dunningCancelledMail(
  subscription: SubscriptionRecord,
  runId: string,
): MailToQueue {
  return ({
    dedupeKey: `dunning:${runId}:cancelled`,
    to: subscription.customer_email,
    subject: 'Your Ceibo subscription has been cancelled',
    body: [
      "Your Ceibo subscription has been cancelled because we couldn't take payment.",
      'You can start a new box any time at ' + env.app.publicUrl + '/box',
      '',
      'Ceibo',
    ].join('\n'),
  });
}

export function applicationDecisionMail(input: {
  email: string;
  applicationId: string;
  businessName: string;
  approved: boolean;
}): MailToQueue {
  return ({
    dedupeKey: `application-decision:${input.applicationId}`,
    to: input.email,
    subject: input.approved
      ? 'Your Ceibo stockist application was approved'
      : 'Your Ceibo stockist application was declined',
    body: input.approved
      ? [
          `Good news. ${input.businessName} is approved to stock Ceibo.`,
          'We will be in touch about your first order.',
          '',
          'Ceibo',
        ].join('\n')
      : [
          `Thank you for applying to stock Ceibo at ${input.businessName}.`,
          'We cannot take on new stockists in your area right now.',
          '',
          'Ceibo',
        ].join('\n'),
  });
}
