import { CycleRow, all, one, run, tx } from "../db";
import { ApiError, errors } from "../errors";
import { centsToDollarsString, dollarsNumberToCents } from "../money";
import { config } from "../db";
import { creditOf, writeMovement } from "./ledger";
import {
  createAccount,
  createPurchase,
  ensurePaymentMethod,
  findAccount,
  findPaymentByExternalKey,
} from "../providers/killbill";
import { deliverSoon } from "../providers/mailworker";

export interface TopupResult {
  topup: { id: number; amount_cents: number; status: "confirmed"; created_at: number };
  credit: ReturnType<typeof creditOf>;
}

/** Confirms a top-up with Kill Bill and writes its single ledger movement. */
export async function confirmTopup(householdCode: string, idempotencyKey: string, amountCents: number): Promise<TopupResult> {
  const hh = one<{ code: string; name: string; email: string }>("SELECT * FROM households WHERE code = ?", householdCode)!;
  const externalKey = `topup-${householdCode}-${idempotencyKey}`;
  const accountKey = `${config.kbKeyPrefix}-${householdCode}`;
  let accountId = await findAccount(accountKey);
  if (accountId === null) {
    accountId = await createAccount(accountKey, hh.name, hh.email);
  }
  await ensurePaymentMethod(accountId);
  const payment = await findPaymentByExternalKey(externalKey);
  if (payment !== null) {
    const txn = payment.transactions?.find((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
    const paidCents = txn ? dollarsNumberToCents(txn.amount) : null;
    if (txn && paidCents !== null && paidCents === amountCents) {
      return finalizeTopup(householdCode, idempotencyKey, amountCents);
    }
    if (txn && paidCents !== null && paidCents !== amountCents) {
      throw errors.idempotencyKeyReused();
    }
    if (txn && paidCents === null) throw errors.paymentsPaused();
  }
  await createPurchase(accountId, centsToDollarsString(amountCents), externalKey);
  return finalizeTopup(householdCode, idempotencyKey, amountCents);
}

function finalizeTopup(householdCode: string, idempotencyKey: string, amountCents: number): TopupResult {
  const nowSec = Math.floor(Date.now() / 1000);
  return tx(() => {
    const already = one<{ id: number; amount_cents: number; created_at: number }>(
      "SELECT * FROM topups WHERE household_code = ? AND idempotency_key = ?",
      householdCode, idempotencyKey
    );
    if (already) {
      return {
        topup: { id: already.id, amount_cents: already.amount_cents, status: "confirmed" as const, created_at: already.created_at },
        credit: creditOf(householdCode),
      };
    }
    const t = run(
      "INSERT INTO topups (household_code, amount_cents, idempotency_key, created_at) VALUES (?, ?, ?, ?)",
      householdCode, amountCents, idempotencyKey, nowSec
    );
    writeMovement(householdCode, "top_up", null, "Top-up", nowSec, `household:${householdCode}`, "clearing:killbill", amountCents);
    return {
      topup: { id: Number(t.lastInsertRowid), amount_cents: amountCents, status: "confirmed" as const, created_at: nowSec },
      credit: creditOf(householdCode),
    };
  });
}

export function topupsOf(householdCode: string): { id: number; amount_cents: number; status: string; created_at: number }[] {
  return all(
    "SELECT id, amount_cents, 'confirmed' AS status, created_at FROM topups WHERE household_code = ? ORDER BY id DESC",
    householdCode
  );
}
