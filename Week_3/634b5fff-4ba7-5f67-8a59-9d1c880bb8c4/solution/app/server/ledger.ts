import { EDITION_PRICE } from "../shared/domain.js";
import { pool } from "./db.js";
import { adjustShares, createInvoice, ensureAccount, recordPayment, type ShareName } from "./killbill.js";
import { orderRate, saleParts, type OrderRow } from "./orders.js";
import type { RefundRow } from "./refunds.js";

/** Writes an order's money events to Kill Bill, each step safe to repeat. */

const sharesOf = async (order: OrderRow): Promise<Record<ShareName, number>> => {
  const parts = saleParts(await orderRate(pool, order));
  return {
    "maker share": parts.makerOre, "charity share": parts.charityOre, VAT: parts.vatOre, courier: EDITION_PRICE.courierOre,
  };
};

const accountOf = async (order: OrderRow): Promise<string> =>
  order.kb_account_id ?? ensureAccount(order.buyer_email ?? "", order.buyer_name ?? "");

const ensureInvoice = async (order: OrderRow): Promise<string> => {
  if (order.kb_invoice_id) return order.kb_invoice_id;
  const accountId = await accountOf(order);
  const invoiceId = await createInvoice(accountId, await sharesOf(order));
  await pool.query("UPDATE orders SET kb_invoice_id = $2, kb_account_id = $3 WHERE reference = $1", [order.reference, invoiceId, accountId]);
  order.kb_invoice_id = invoiceId;
  return invoiceId;
};

const rememberPayment = async (order: OrderRow, paymentId: string): Promise<void> => {
  await pool.query("UPDATE orders SET kb_payment_id = $2 WHERE reference = $1", [order.reference, paymentId]);
  order.kb_payment_id = paymentId;
};

export const recordAuthorisation = async (order: OrderRow): Promise<void> => {
  await ensureInvoice(order);
  await rememberPayment(order, await recordPayment(await accountOf(order), order.reference, "AUTHORIZE", EDITION_PRICE.totalOre, `${order.reference}-authorize`));
  await pool.query("UPDATE orders SET kb_closed = false WHERE reference = $1", [order.reference]);
};

export const recordCapture = async (order: OrderRow): Promise<void> => {
  await recordPayment(await accountOf(order), order.reference, "CAPTURE", EDITION_PRICE.totalOre, `${order.reference}-capture`);
};

export const recordSettlement = async (order: OrderRow): Promise<void> => {
  await ensureInvoice(order);
  await rememberPayment(order, await recordPayment(await accountOf(order), order.reference, "PURCHASE", EDITION_PRICE.totalOre, `${order.reference}-purchase`));
};

export const recordRefund = async (order: OrderRow, refund: RefundRow): Promise<void> => {
  const account = await accountOf(order);
  await recordPayment(account, order.reference, "REFUND", refund.amount_ore, refund.refund_id);
  await adjustShares(account, await ensureInvoice(order), {
    "maker share": refund.maker_ore, "charity share": refund.charity_ore, VAT: refund.vat_ore,
  }, refund.refund_id);
};

/** A voided or expired authorisation: VOID the payment and adjust every invoice item to zero. */
export const recordClosure = async (order: OrderRow): Promise<void> => {
  if (order.kb_payment_id) await recordPayment(await accountOf(order), order.reference, "VOID", 0, `${order.reference}-void`);
  if (order.kb_invoice_id) {
    await adjustShares(await accountOf(order), order.kb_invoice_id, await sharesOf(order), `${order.reference}-close`);
  }
  await pool.query("UPDATE orders SET kb_closed = true WHERE reference = $1", [order.reference]);
};
