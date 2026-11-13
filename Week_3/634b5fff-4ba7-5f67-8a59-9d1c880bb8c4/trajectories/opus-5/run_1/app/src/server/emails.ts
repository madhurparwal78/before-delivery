import { formatKroner } from '../shared/money.js';
import { config } from './config.js';
import { formatCopenhagenLocal } from './copenhagen.js';
import type { OrderRow } from './orders.js';
import { sendMail } from './services/mail.js';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return '&quot;';
  });
}

function orderLink(order: OrderRow): string {
  return `${config.publicUrl}/order/${order.reference}?token=${order.order_token}`;
}

function page(body: string): string {
  return `<!doctype html><html lang="en"><body style="font-family:Georgia,serif;color:#0b1020">${body}</body></html>`;
}

export async function sendAuthorisationNotice(order: OrderRow): Promise<void> {
  await sendMail(
    order.buyer_email,
    `Box ${order.box_number} is reserved: card authorised (${order.reference})`,
    page(
      `<p>Box ${order.box_number} of the Last Bundle is reserved for you.</p>
       <p>Your card is authorised. You have not been charged yet.</p>
       <p><a href="${orderLink(order)}">Your order ${escapeHtml(order.reference)}</a></p>`,
    ),
  );
}

export async function sendReceipt(order: OrderRow): Promise<void> {
  await sendMail(
    order.buyer_email,
    `Your receipt for box ${order.box_number} (${order.reference})`,
    page(
      `<p>Thank you for box ${order.box_number}, plate ${escapeHtml(order.plate)}.</p>
       <p>Total: DKK ${formatKroner(order.total_ore)}</p>
       <p>VAT: DKK ${formatKroner(order.vat_ore)}</p>
       <p>Courier: DKK ${formatKroner(order.courier_ore)}</p>
       <p>Charity share: DKK ${formatKroner(order.charity_ore)}</p>
       <p><a href="${orderLink(order)}">Your order ${escapeHtml(order.reference)}</a></p>`,
    ),
  );
}

export async function sendTransferInstructions(
  order: OrderRow,
  transfer: { iban: string; paymentReference: string; amountOre: number; deadlineAt: Date },
): Promise<void> {
  await sendMail(
    order.buyer_email,
    `Bank transfer instructions for box ${order.box_number} (${order.reference})`,
    page(
      `<p>Box ${order.box_number} is reserved for your bank transfer.</p>
       <p>IBAN: ${escapeHtml(transfer.iban)}</p>
       <p>Payment reference: ${escapeHtml(transfer.paymentReference)}</p>
       <p>Amount: DKK ${formatKroner(transfer.amountOre)}</p>
       <p>Deadline: ${formatCopenhagenLocal(transfer.deadlineAt)}</p>
       <p><a href="${orderLink(order)}">Your order ${escapeHtml(order.reference)}</a></p>`,
    ),
  );
}

export async function sendLapseNotice(order: OrderRow): Promise<void> {
  await sendMail(
    order.buyer_email,
    `Your transfer deadline passed: box ${order.box_number} (${order.reference})`,
    page(
      `<p>Your transfer deadline passed. Box ${order.box_number} is back on the shelf.</p>
       <p><a href="${orderLink(order)}">Your order ${escapeHtml(order.reference)}</a></p>`,
    ),
  );
}

export async function sendRefundNotice(order: OrderRow, amountOre: number): Promise<void> {
  await sendMail(
    order.buyer_email,
    `Refund for box ${order.box_number} (${order.reference})`,
    page(
      `<p>DKK ${formatKroner(amountOre)} has been refunded for box ${order.box_number}.</p>
       <p><a href="${orderLink(order)}">Your order ${escapeHtml(order.reference)}</a></p>`,
    ),
  );
}

/** The gift notice carries no price, amount, currency or order reference. */
export async function sendGiftNotice(order: OrderRow): Promise<void> {
  if (order.recipient_email === null) return;
  await sendMail(
    order.recipient_email,
    'A numbered box is on its way to you',
    page(
      `<p>Dear ${escapeHtml(order.recipient_name ?? '')},</p>
       <p>Box ${order.box_number} of The Last Bundle from Svovlstik Press is on its way to you.</p>
       <p>Plate: ${escapeHtml(order.plate)}</p>
       <p>${escapeHtml(order.gift_message ?? '')}</p>`,
    ),
  );
}
