/** Transfers between a company's own accounts: a paired debit and credit in one transaction. */
import type { Tx } from "../db.js";
import { Fields, notFound, refusal } from "../http/errors.js";
import type { SessionUser } from "../http/context.js";
import { isId, newId } from "../ids.js";
import { lockAccounts } from "./accounts.js";
import { appendAudit } from "./audit.js";
import { recordTransaction } from "./ledger.js";
import { readAmountCents, readMemo } from "./validate.js";

interface TransferInput {
  from_account_id: unknown;
  to_account_id: unknown;
  amount_cents: unknown;
  memo: unknown;
}

/** The body keys this endpoint reads, in one list. */
export function readTransferKeys(body: Record<string, unknown>): TransferInput {
  return { from_account_id: body.from_account_id, to_account_id: body.to_account_id, amount_cents: body.amount_cents, memo: body.memo };
}

export async function createTransfer(tx: Tx, user: SessionUser, input: TransferInput, now: Date) {
  const fields = new Fields();
  const ids: string[] = [];
  for (const key of ["from_account_id", "to_account_id"] as const) {
    const value = input[key];
    if (value === undefined) fields.fail(key, "Choose an account");
    else if (!isId(value)) throw notFound();
    else ids.push(value);
  }
  const locked = ids.length === 2 ? await lockAccounts(tx, user.companyId, ids) : new Map();
  const from = typeof input.from_account_id === "string" ? locked.get(input.from_account_id) : undefined;
  const to = typeof input.to_account_id === "string" ? locked.get(input.to_account_id) : undefined;
  const amount = readAmountCents(input.amount_cents, fields, "amount_cents");
  const memo = readMemo(input.memo, fields);
  if (from && to && from.id === to.id) fields.fail("to_account_id", "Choose a different account");
  fields.raise();
  if (!from || !to || amount === null) throw new Error("unreachable: validated transfer");
  if (from.available_cents < amount) throw refusal(400, "insufficient_funds");

  const id = newId();
  await recordTransaction(tx, { companyId: user.companyId, accountId: from.id, direction: "debit", amountCents: amount, method: "transfer", counterparty: to.name, memo, transferId: id, createdAt: now });
  await recordTransaction(tx, { companyId: user.companyId, accountId: to.id, direction: "credit", amountCents: amount, method: "transfer", counterparty: from.name, memo, transferId: id, createdAt: now });
  await appendAudit(tx, user.companyId, "transfer.posted", null, amount, user.email);
  return { id, from_account_id: from.id, to_account_id: to.id, amount_cents: amount, memo };
}
