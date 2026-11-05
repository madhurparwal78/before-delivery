// All-or-nothing buyout: bill of sale written, one charge for payoff plus tax, the subscription confirmed
// cancelled, then one commit. Any failure deletes the bill of sale and changes nothing else.

import { nowSecond, storeToday } from "../clock.js";
import { inTransaction } from "../db/pool.js";
import { ApiError, idempotencyConflict, invalidTransition, validationFailed } from "../http/errors.js";
import { fieldOf, newId, wholeNumber } from "../http/fields.js";
import type { Reply, Request } from "../http/router.js";
import { ensureAccount, purchaseOnce } from "../services/killbill.js";
import { billOfSaleKey, deleteWritten, putObject } from "../services/storage.js";
import { accountHolder, confirmSubscriptionCancelled, lockedRow } from "./closing.js";
import { moveContract } from "./contractStates.js";
import { freshContractBody, requireVisible } from "./contracts.js";
import { billOfSalePdf } from "./documents.js";
import { idempotent } from "./idempotency.js";
import { queueOwnershipLetter } from "./payments.js";
import { contractMonth, contractTerms, loadPriceLists, quoteFor } from "./terms.js";

export async function buyOut(request: Request, id: string): Promise<Reply> {
  const user = request.user;
  await requireVisible(user, id);
  return idempotent(request, id, "buyout", null, async (db, idempotency) => {
    const row = await lockedRow(db, id);
    if (row.status !== "active") throw invalidTransition();
    if (idempotency.conflicting) throw idempotencyConflict();
    const expected = wholeNumber(fieldOf(request.body, "expected_payoff_cents"), Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const fields: Record<string, string> = { ...idempotency.keyFields };
    if (expected === null) fields.expected_payoff_cents = "invalid";
    if (expected === null || Object.keys(fields).length > 0) throw validationFailed(fields);
    const today = storeToday();
    const terms = contractTerms(row, await loadPriceLists(db), today);
    const quote = quoteFor(id, terms, row.equity_cents, contractMonth(row.equity_cents, terms), today);
    if (expected !== quote.payoff_cents) {
      throw new ApiError(409, "quote_changed", "The payoff has changed; review the new quote.", { quote });
    }
    const at = nowSecond();
    const written: string[] = [];
    let killbillPaymentId: string;
    try {
      await putObject(billOfSaleKey(id), billOfSalePdf(row, quote.total_cents, at), "application/pdf");
      written.push(billOfSaleKey(id));
      const accountId = await ensureAccount(accountHolder(row));
      killbillPaymentId = await purchaseOnce(accountId, `${id}-buyout`, quote.total_cents);
      await confirmSubscriptionCancelled(row);
    } catch (error) {
      await deleteWritten(written);
      throw error;
    }
    try {
      return await inTransaction(db, async () => {
        await db.query(`INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, created_at)
          VALUES ($1, $2, 'buyout', $3, $4)`, [newId("L"), id, quote.remaining_cents, at]);
        await moveContract(db, { id, from: "active", to: "paid_off",
          actor: { actor: user.role === "parent" ? "parent" : "owner", actor_name: user.name }, at,
          set: { closed_at: at, subscription_state: "cancelled", bill_of_sale_stored: true } });
        await queueOwnershipLetter(db, row, terms.purchase_price_cents, quote.total_cents);
        return idempotency.respond(db, 200, {
          contract: await freshContractBody(db, id),
          buyout: { payoff_cents: quote.payoff_cents, discount_cents: quote.discount_cents,
            remaining_cents: quote.remaining_cents, tax_cents: quote.tax_cents, total_cents: quote.total_cents,
            tier: quote.tier, killbill_payment_id: killbillPaymentId },
        });
      });
    } catch (error) {
      await deleteWritten(written);
      throw error;
    }
  });
}
