/** The venture line: draws credit the funding account and raise the drawn amount in one transaction. */
import type { Tx } from "../db.js";
import { Fields, notFound, refusal } from "../http/errors.js";
import type { SessionUser } from "../http/context.js";
import { isId } from "../ids.js";
import { findAccount } from "./accounts.js";
import { appendAudit } from "./audit.js";
import { recordTransaction } from "./ledger.js";
import { readAmountCents } from "./validate.js";

import type { Row } from "./row.js";

interface LoanView {
  id: string;
  name: string;
  principal_cents: number;
  drawn_cents: number;
  remaining_cents: number;
  funding_account_id: string;
}

function loanView(row: Row): LoanView {
  return {
    id: row.id,
    name: row.name,
    principal_cents: row.principal_cents,
    drawn_cents: row.drawn_cents,
    remaining_cents: row.principal_cents - row.drawn_cents,
    funding_account_id: row.funding_account_id,
  };
}

export async function listLoans(tx: Tx, companyId: string): Promise<LoanView[]> {
  const found = await tx.query("SELECT * FROM loans WHERE company_id = $1 ORDER BY created_at, id", [companyId]);
  return found.rows.map(loanView);
}

/** Proves the loan belongs to the company without locking it (404 otherwise). */
export async function requireLoan(tx: Tx, companyId: string, id: unknown): Promise<void> {
  if (!isId(id)) throw notFound();
  const found = await tx.query("SELECT 1 FROM loans WHERE id = $1 AND company_id = $2", [id, companyId]);
  if (!found.rows[0]) throw notFound();
}

export async function drawLoan(tx: Tx, user: SessionUser, id: string, amountValue: unknown, now: Date): Promise<LoanView> {
  const fields = new Fields();
  const amount = readAmountCents(amountValue, fields, "amount_cents");
  fields.raise();
  if (amount === null) throw new Error("unreachable: validated amount");
  const found = await tx.query("SELECT * FROM loans WHERE id = $1 AND company_id = $2 FOR UPDATE", [id, user.companyId]);
  const loan = found.rows[0];
  if (amount > loan.principal_cents - loan.drawn_cents) throw refusal(400, "exceeds_available_credit");
  await findAccount(tx, user.companyId, loan.funding_account_id, true);
  await recordTransaction(tx, {
    companyId: user.companyId,
    accountId: loan.funding_account_id,
    direction: "credit",
    amountCents: amount,
    method: "wire",
    counterparty: loan.name,
    memo: null,
    transferId: null,
    createdAt: now,
  });
  const updated = await tx.query("UPDATE loans SET drawn_cents = drawn_cents + $2 WHERE id = $1 RETURNING *", [id, amount]);
  await appendAudit(tx, user.companyId, "loan.drawn", null, amount, user.email);
  return loanView(updated.rows[0]);
}

