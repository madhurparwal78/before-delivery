// The six notices (brief: Mailpit): subjects and bodies, written to the outbox in the caller's transaction.
import type { Tx } from "../db.ts";
import { iso, now } from "../clock.ts";
import { formatPrice } from "../money.ts";
import { dayAndTime, shortDate } from "../zones.ts";
import { wakeSender } from "../outbox.ts";

type Template = "order_confirmed" | "trade_in_quoted" | "demo_booked" | "callback_requested" | "case_opened" | "password_reset";

interface Notice {
  to: string;
  template: Template;
  reference: string | null;
  subject: string;
  body: string;
  resetTokenId?: number;
}

async function queue(tx: Tx, notice: Notice): Promise<void> {
  await tx.query(
    `INSERT INTO outbox (to_addr, template, reference, subject, body, reset_token_id, status, attempts, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, clock_timestamp(), $7)`,
    [notice.to, notice.template, notice.reference, notice.subject, notice.body, notice.resetTokenId ?? null, now()],
  );
  wakeSender();
}

interface OrderSummary {
  number: string;
  lines: { name: string; quantity: number; line_cents: number }[];
  discounts: { amount_cents: number }[];
  credits: { amount_cents: number }[];
  shipping_cents: number;
  dangerous_goods_cents: number;
  taxes: { name: string; amount_cents: number }[];
  tax_cents: number;
  total_cents: number;
  arrives_on: string;
}

export function orderConfirmed(tx: Tx, to: string, order: OrderSummary): Promise<void> {
  const off = [...order.discounts, ...order.credits].reduce((s, d) => s + d.amount_cents, 0);
  const body = [
    `Order ${order.number}`,
    ...order.lines.map((l) => `${l.name} x ${l.quantity}: ${formatPrice(l.line_cents)}`),
    ...(off > 0 ? [`Discounts and credits: -${formatPrice(off)}`] : []),
    `Shipping: ${formatPrice(order.shipping_cents)}`,
    `Dangerous goods handling: ${formatPrice(order.dangerous_goods_cents)}`,
    ...order.taxes.map((t) => `${t.name}: ${formatPrice(t.amount_cents)}`),
    `Tax: ${formatPrice(order.tax_cents)}`,
    `Total: ${formatPrice(order.total_cents)}`,
    `Arrives ${shortDate(order.arrives_on)}`,
  ].join("\n");
  return queue(tx, { to, template: "order_confirmed", reference: order.number, subject: `Order confirmed: ${order.number}`, body });
}

export function tradeInQuoted(tx: Tx, to: string, id: number, cents: number, expires: Date): Promise<void> {
  const body = [
    `Your trade-in ${id} has been quoted at ${formatPrice(cents)} of credit toward a Crest.`,
    `The quote is valid until ${iso(expires)}.`,
    "Accept or decline it on your trade-in page.",
  ].join("\n");
  return queue(tx, { to, template: "trade_in_quoted", reference: String(id), subject: `Trade-in quoted: ${formatPrice(cents)}`, body });
}

export function demoBooked(tx: Tx, to: string, bookingId: number, location: string, label: string): Promise<void> {
  const body = [`Booking ${bookingId}: one seat at ${location}.`, label, "See you on the water."].join("\n");
  return queue(tx, { to, template: "demo_booked", reference: String(bookingId), subject: `Demo booked: ${location}`, body });
}

interface CallbackSummary {
  reference: string;
  name: string;
  start: Date;
  zone: string;
  buildCode: string | null;
}

export function callbackRequested(tx: Tx, to: string, callback: CallbackSummary): Promise<void> {
  const local = dayAndTime(callback.start, callback.zone);
  const body = [
    `Hi ${callback.name.split(" ")[0]},`,
    `Reference ${callback.reference}`,
    `We will call you on ${local.day} at ${local.time} ${callback.zone} (${dayAndTime(callback.start, "UTC").time} UTC).`,
    ...(callback.buildCode ? [`Build ${callback.buildCode}`] : []),
  ].join("\n");
  return queue(tx, { to, template: "callback_requested", reference: callback.reference, subject: `Callback requested: ${callback.reference}`, body });
}

export function caseOpened(tx: Tx, to: string, reference: string, subject: string): Promise<void> {
  const body = [`Your support case ${reference} is open.`, `Subject: ${subject}`, "We reply within two business days."].join("\n");
  return queue(tx, { to, template: "case_opened", reference, subject: `Support case opened: ${reference}`, body });
}

/** The reset link is never stored in the outbox row: the sender reads it from reset_tokens at send time. */
export function passwordReset(tx: Tx, to: string, resetTokenId: number): Promise<void> {
  const body = "Use the link below within 30 minutes to choose a new password.\n\n{reset_link}\n\nIf you did not ask for this, ignore this email.";
  return queue(tx, { to, template: "password_reset", reference: null, subject: "Reset your Tern Foils password", body, resetTokenId });
}
