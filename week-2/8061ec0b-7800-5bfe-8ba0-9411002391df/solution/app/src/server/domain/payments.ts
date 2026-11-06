// Recording payments and reversing them. A payment reaches Kill Bill before any equity is credited; a reversal
// refunds the original payment before its reversal entry is written.

import type { Payment, Reversal } from "../../shared/api.js";
import { formatMoney, formatTaxPercent } from "../../shared/money.js";
import { formatDateTime, isoSecond } from "../../shared/storeTime.js";
import { instrumentLabel, REVERSAL_REASON_WORDS, REVERSAL_REASONS, type ReversalReason } from "../../shared/vocabulary.js";
import { nowSecond, storeToday } from "../clock.js";
import { inTransaction, pool, query, type Db } from "../db/pool.js";
import { ApiError, idempotencyConflict, invalidTransition, notFound, validationFailed } from "../http/errors.js";
import { fieldOf, newId, oneOf, wholeNumber } from "../http/fields.js";
import type { Request, Reply } from "../http/router.js";
import { ensureAccount, ensureSubscription, purchaseOnce, refundOnce } from "../services/killbill.js";
import { appLink, queueEmail } from "../services/mail.js";
import { billOfSaleKey, deleteWritten, putObject } from "../services/storage.js";
import { accountHolder, confirmSubscriptionCancelled, lockedRow, ownerActor } from "./closing.js";
import { moveContract } from "./contractStates.js";
import { freshContractBody, requireVisible, type ContractRow } from "./contracts.js";
import { billOfSalePdf } from "./documents.js";
import { idempotent } from "./idempotency.js";
import { contractMonth, contractTerms, loadPriceLists, splitPayment } from "./terms.js";

interface PaymentRow {
  id: string; contract_id: string; amount_cents: number; base_rent_cents: number; waiver_cents: number;
  tax_cents: number; killbill_payment_id: string; created_at: Date;
}

function paymentBody(row: PaymentRow): Payment {
  return { id: row.id, amount_cents: row.amount_cents, base_rent_cents: row.base_rent_cents,
    waiver_cents: row.waiver_cents, tax_cents: row.tax_cents, killbill_payment_id: row.killbill_payment_id,
    created_at: isoSecond(row.created_at) };
}

/** Queues the ownership letter for a contract that has just been paid off. */
export async function queueOwnershipLetter(db: Db, row: ContractRow, purchasePrice: number, amountPaid: number): Promise<void> {
  const label = instrumentLabel(row.instrument_type, row.size);
  await queueEmail(db, {
    to: row.parent_email, subject: `You own it — ${label} ${row.instrument_serial}`,
    body: [`Dear ${row.parent_name},`, "",
      `${row.student_name} now owns the ${label}, serial ${row.instrument_serial}.`,
      `Purchase price: ${formatMoney(purchasePrice)}`, `Amount paid at close: ${formatMoney(amountPaid)}`, "",
      `Your bill of sale: ${appLink(`/api/contracts/${row.id}/bill-of-sale.pdf`)}`, "", "Keel & Bell Music"].join("\n"),
  });
}

export async function recordPayment(request: Request, id: string): Promise<Reply> {
  const user = request.user;
  await requireVisible(user, id);
  return idempotent(request, id, "payment", null, async (db, idempotency) => {
    const row = await lockedRow(db, id);
    if (row.status !== "active") throw invalidTransition();
    if (idempotency.conflicting) throw idempotencyConflict();
    const cents = wholeNumber(fieldOf(request.body, "amount_cents"), 1, 1_000_000);
    const fields: Record<string, string> = { ...idempotency.keyFields };
    if (cents === null) fields.amount_cents = "invalid";
    if (cents === null || Object.keys(fields).length > 0) throw validationFailed(fields);
    const lists = await loadPriceLists(db);
    const terms = contractTerms(row, lists, storeToday());
    const split = splitPayment(cents, terms, row.waiver);
    const remaining = terms.purchase_price_cents - row.equity_cents;
    if (split.base_rent_cents > remaining) throw validationFailed({ amount_cents: "exceeds_remaining" });
    const paysOff = split.base_rent_cents === remaining;
    const at = nowSecond();
    const written: string[] = [];
    let killbillPaymentId: string;
    try {
      if (paysOff) {
        await putObject(billOfSaleKey(id), billOfSalePdf(row, cents, at), "application/pdf");
        written.push(billOfSaleKey(id));
      }
      const accountId = await ensureAccount(accountHolder(row));
      if (row.subscription_state === null && !paysOff) await ensureSubscription(accountId, id);
      killbillPaymentId = await purchaseOnce(accountId, `${id}-pay-${idempotency.key}`, cents);
      if (paysOff) await confirmSubscriptionCancelled(row);
    } catch (error) {
      await deleteWritten(written);
      throw error;
    }
    try {
      return await inTransaction(db, async () => {
        const payment: PaymentRow = { id: newId("P"), contract_id: id, amount_cents: cents, ...split,
          killbill_payment_id: killbillPaymentId, created_at: at };
        await db.query(`INSERT INTO payments (id, contract_id, amount_cents, base_rent_cents, waiver_cents, tax_cents,
          killbill_payment_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [payment.id, id, cents,
          split.base_rent_cents, split.waiver_cents, split.tax_cents, killbillPaymentId, at]);
        await db.query(`INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, payment_id, created_at)
          VALUES ($1, $2, 'payment', $3, $4, $5)`, [newId("L"), id, split.base_rent_cents, payment.id, at]);
        const equity = row.equity_cents + split.base_rent_cents;
        await queueEmail(db, {
          to: row.parent_email, subject: `Payment received — ${id}`,
          body: [`Dear ${row.parent_name},`, "",
            `We received ${formatMoney(cents)} for contract ${id} (${instrumentLabel(row.instrument_type, row.size)} ${row.instrument_serial}) on ${formatDateTime(at)}.`,
            "", `Rent toward ownership: ${formatMoney(split.base_rent_cents)}`,
            `Waiver: ${formatMoney(split.waiver_cents)}`,
            `Sales tax at ${formatTaxPercent(terms.tax_rate_bp)}: ${formatMoney(split.tax_cents)}`, "",
            `Equity now: ${formatMoney(equity)} of ${formatMoney(terms.purchase_price_cents)}`, "",
            `Your contract: ${appLink(`/contracts/${id}?month=${contractMonth(equity, terms)}`)}`, "", "Keel & Bell Music"].join("\n"),
        });
        if (!paysOff && row.subscription_state === null) {
          await db.query("UPDATE contracts SET subscription_state = 'active' WHERE id = $1", [id]);
        }
        if (paysOff) {
          await moveContract(db, { id, from: "active", to: "paid_off", actor: ownerActor(user), at,
            set: { closed_at: at, subscription_state: "cancelled", bill_of_sale_stored: true } });
          await queueOwnershipLetter(db, row, terms.purchase_price_cents, cents);
        }
        return idempotency.respond(db, 201, { payment: paymentBody(payment), contract: await freshContractBody(db, id) });
      });
    } catch (error) {
      await deleteWritten(written);
      throw error;
    }
  });
}

function reversalBody(row: PaymentRow & { reversal_id: string; reason: ReversalReason; killbill_refund_id: string;
  reversed_at: Date }): Reversal {
  return { id: row.reversal_id, payment_id: row.id, reason: row.reason, amount_cents: row.amount_cents,
    base_rent_cents: row.base_rent_cents, waiver_cents: row.waiver_cents, tax_cents: row.tax_cents,
    killbill_refund_id: row.killbill_refund_id, created_at: isoSecond(row.reversed_at) };
}

export async function reversePayment(request: Request, id: string, paymentId: string): Promise<Reply> {
  const user = request.user;
  await requireVisible(user, id);
  const [found] = await query<PaymentRow>(pool,
    "SELECT * FROM payments WHERE id = $1 AND contract_id = $2", [paymentId, id]);
  if (found === undefined) throw notFound();
  return idempotent(request, id, "reversal", { payment_id: paymentId }, async (db, idempotency) => {
    const row = await lockedRow(db, id);
    if (row.status !== "active") throw invalidTransition();
    if (idempotency.conflicting) throw idempotencyConflict();
    const [reversed] = await query(db, "SELECT 1 FROM reversals WHERE payment_id = $1", [paymentId]);
    if (reversed !== undefined) throw new ApiError(409, "payment_reversed", "This payment was already reversed.");
    const why = oneOf(fieldOf(request.body, "reason"), REVERSAL_REASONS);
    const fields: Record<string, string> = { ...idempotency.keyFields };
    if (why === null) fields.reason = "invalid";
    if (why === null || Object.keys(fields).length > 0) throw validationFailed(fields);
    const refundId = await refundOnce(found.killbill_payment_id, `${id}-reversal-${paymentId}`, found.amount_cents);
    const at = nowSecond();
    return inTransaction(db, async () => {
      const reversalId = newId("R");
      await db.query(`INSERT INTO reversals (id, payment_id, contract_id, reason, amount_cents, base_rent_cents,
        waiver_cents, tax_cents, killbill_refund_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [reversalId, paymentId, id, why, found.amount_cents, found.base_rent_cents, found.waiver_cents, found.tax_cents,
        refundId, at]);
      await db.query(`INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, payment_id, created_at)
        VALUES ($1, $2, 'reversal', $3, $4, $5)`, [newId("L"), id, -found.base_rent_cents, paymentId, at]);
      const equity = row.equity_cents - found.base_rent_cents;
      await queueEmail(db, {
        to: row.parent_email, subject: `Payment reversed — ${id}`,
        body: [`Dear ${row.parent_name},`, "", `Payment ${paymentId} on contract ${id} was reversed (${REVERSAL_REASON_WORDS[why]}).`,
          "", `Amount refunded: ${formatMoney(found.amount_cents)}`,
          `Rent toward ownership: ${formatMoney(found.base_rent_cents)}`, `Waiver: ${formatMoney(found.waiver_cents)}`,
          `Sales tax: ${formatMoney(found.tax_cents)}`, "", `Equity removed: ${formatMoney(found.base_rent_cents)}`,
          `Equity now: ${formatMoney(equity)}`, "", `Your contract: ${appLink(`/contracts/${id}`)}`, "",
          "Keel & Bell Music"].join("\n"),
      });
      return idempotency.respond(db, 201, {
        reversal: reversalBody({ ...found, reversal_id: reversalId, reason: why, killbill_refund_id: refundId, reversed_at: at }),
        contract: await freshContractBody(db, id),
      });
    });
  });
}
