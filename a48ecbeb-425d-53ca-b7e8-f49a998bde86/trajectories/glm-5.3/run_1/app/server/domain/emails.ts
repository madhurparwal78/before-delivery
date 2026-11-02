import { queueEmail, dollars } from '../services/mail.js';
import { formatTorontoDate, formatTorontoDateTime } from './geo.js';
import type { RefundSplit } from './refund.js';

export async function queueOrderConfirmation(order: {
  number: string;
  email: string;
  lines: { flavour: string; quantity: number; goods_cents: number; discount_cents: number }[];
  deposit_cents: number;
  shipping_cents: number;
  taxes: { name: string; cents: number }[];
  total_cents: number;
}, publicUrl: string): Promise<void> {
  const lines = order.lines.map((l) => `${l.quantity} x ${l.flavour}: ${dollars(l.goods_cents - l.discount_cents)}`).join('\n');
  const taxes = order.taxes.map((t) => `${t.name}: ${dollars(t.cents)}`).join('\n');
  const body = [
    `Order ${order.number} is confirmed.`,
    '',
    lines,
    `Deposit: ${dollars(order.deposit_cents)}`,
    `Shipping: ${order.shipping_cents === 0 ? 'Free' : dollars(order.shipping_cents)}`,
    taxes,
    `Total: ${dollars(order.total_cents)}`,
    '',
    `Your invoice: ${publicUrl}/api/orders/${order.number}/invoice.pdf`,
  ].join('\n');
  await queueEmail(order.email, `Your Ceibo order ${order.number} is confirmed`, body);
}

export async function queueReceiptCopy(order: { number: string; email: string }, publicUrl: string): Promise<void> {
  const body = [
    `Order ${order.number} receipt (copy).`,
    '',
    `Your invoice: ${publicUrl}/api/orders/${order.number}/invoice.pdf`,
  ].join('\n');
  await queueEmail(order.email, `Your Ceibo order ${order.number} receipt (copy)`, body);
}

export async function queueRenewalPaid(order: { number: string; email: string; total_cents: number }): Promise<void> {
  const body = [
    `Your Ceibo box renewed. Order ${order.number} is confirmed.`,
    `Total: ${dollars(order.total_cents)}`,
  ].join('\n');
  await queueEmail(order.email, `Your Ceibo box renewed: order ${order.number}`, body);
}

export async function queueUpcomingRenewal(email: string, nextDate: string): Promise<void> {
  const body = `Your next Ceibo box renews on ${formatTorontoDate(nextDate)}. You can change your box any time before the change cutoff.`;
  await queueEmail(email, `Your next Ceibo box renews on ${formatTorontoDate(nextDate)}`, body);
}

export async function queueChangeApplied(email: string, kind: string, info: { from?: string; resumes?: string; planLabel?: string; endDate?: string }): Promise<void> {
  if (kind === 'pause') {
    const body = `Your Ceibo subscription is paused from ${formatTorontoDate(info.from!)}. It resumes ${formatTorontoDate(info.resumes!)}.`;
    await queueEmail(email, `Your Ceibo subscription is paused`, body);
  } else if (kind === 'skip') {
    const body = `Your next Ceibo box, scheduled for ${formatTorontoDate(info.from!)}, is skipped.`;
    await queueEmail(email, `Your next Ceibo box is skipped`, body);
  } else if (kind === 'swap') {
    const body = `Your Ceibo box is now ${info.planLabel}. The change applies from ${formatTorontoDate(info.from!)}.`;
    await queueEmail(email, `Your Ceibo box is now ${info.planLabel}`, body);
  } else if (kind === 'cancel') {
    const body = `Your Ceibo subscription will end on ${formatTorontoDate(info.endDate!)}. Your boxes stop after that date.`;
    await queueEmail(email, `Your Ceibo subscription will end on ${formatTorontoDate(info.endDate!)}`, body);
  } else if (kind === 'resume') {
    const body = `Your Ceibo subscription is active again. Your next box ships on schedule.`;
    await queueEmail(email, `Your Ceibo subscription is active again`, body);
  }
}

export async function queueDunningEmail(email: string, step: 'day0' | 'retry1' | 'retry2' | 'retry3' | 'hold' | 'cancel', cancelsAt: Date): Promise<void> {
  if (step === 'day0') {
    const body = `Your renewal payment didn't go through. Update your card to keep your boxes coming.`;
    await queueEmail(email, `Your Ceibo renewal didn't go through`, body);
  } else if (step === 'retry1' || step === 'retry2' || step === 'retry3') {
    const r = step === 'retry1' ? 1 : step === 'retry2' ? 2 : 3;
    const body = `Ceibo payment retry ${r} of 3 didn't go through. Update your card to keep your boxes coming.`;
    await queueEmail(email, `Ceibo payment retry ${r} of 3 didn't go through`, body);
  } else if (step === 'hold') {
    const body = `Your Ceibo deliveries are on hold because we couldn't take payment. Update your card before ${formatTorontoDateTime(cancelsAt)} to restart them.`;
    await queueEmail(email, `Your Ceibo deliveries are on hold`, body);
  } else if (step === 'cancel') {
    const body = `Your Ceibo subscription has been cancelled because we couldn't take payment.`;
    await queueEmail(email, `Your Ceibo subscription has been cancelled`, body);
  }
}

export async function queueRefundEmail(order: { number: string; email: string }, amountCents: number, split: RefundSplit): Promise<void> {
  const lines = split.lines
    .map((l) => `${l.flavour}: goods ${dollars(l.goods_cents)}, deposit ${dollars(l.deposit_cents)}`)
    .join('\n');
  const taxes = split.taxes.map((t) => `${t.name}: ${dollars(t.cents)}`).join('\n');
  const body = [
    `Refund of ${dollars(amountCents)} for order ${order.number}.`,
    '',
    lines,
    `Shipping: ${dollars(split.shipping_cents)}`,
    taxes,
  ].join('\n');
  await queueEmail(order.email, `Refund of ${dollars(amountCents)} for order ${order.number}`, body);
}

export async function queueApplicationDecision(email: string, approved: boolean, businessName: string): Promise<void> {
  if (approved) {
    const body = `Good news: your application to stock Ceibo (${businessName}) was approved. We'll be in touch about your first order.`;
    await queueEmail(email, `Your Ceibo stockist application was approved`, body);
  } else {
    const body = `Thanks for your interest in stocking Ceibo (${businessName}). Your application wasn't approved this time.`;
    await queueEmail(email, `Your Ceibo stockist application was declined`, body);
  }
}
