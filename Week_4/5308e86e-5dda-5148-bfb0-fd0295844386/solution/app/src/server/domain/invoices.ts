/** Invoices: draft to sent to paid, and paid into one account exactly once. */
import type { Tx } from "../db.js";
import { Fields, notFound, refusal } from "../http/errors.js";
import type { SessionUser } from "../http/context.js";
import { isId } from "../ids.js";
import { findAccount } from "./accounts.js";
import { appendAudit } from "./audit.js";
import { recordTransaction } from "./ledger.js";

import type { Row } from "./row.js";

interface InvoiceView {
  id: string;
  number: string;
  customer_name: string;
  total_cents: number;
  status: "draft" | "sent" | "paid";
  paid_into_account_id: string | null;
}

function invoiceView(row: Row): InvoiceView {
  return {
    id: row.id,
    number: row.number,
    customer_name: row.customer_name,
    total_cents: row.total_cents,
    status: row.status,
    paid_into_account_id: row.paid_into_account_id,
  };
}

export async function listInvoices(tx: Tx, companyId: string): Promise<InvoiceView[]> {
  const found = await tx.query("SELECT * FROM invoices WHERE company_id = $1 ORDER BY number", [companyId]);
  return found.rows.map(invoiceView);
}

/** Proves the invoice belongs to the company without locking it (404 otherwise). */
export async function requireInvoice(tx: Tx, companyId: string, id: unknown): Promise<void> {
  if (!isId(id)) throw notFound();
  const found = await tx.query("SELECT 1 FROM invoices WHERE id = $1 AND company_id = $2", [id, companyId]);
  if (!found.rows[0]) throw notFound();
}

async function lockInvoice(tx: Tx, companyId: string, id: string): Promise<Row> {
  const found = await tx.query("SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE", [id, companyId]);
  return found.rows[0];
}

export async function sendInvoice(tx: Tx, user: SessionUser, id: string): Promise<InvoiceView> {
  const invoice = await lockInvoice(tx, user.companyId, id);
  if (invoice.status !== "draft") throw refusal(409, "invoice_not_draft");
  const updated = await tx.query("UPDATE invoices SET status = 'sent' WHERE id = $1 RETURNING *", [id]);
  return invoiceView(updated.rows[0]);
}

export async function markPaid(tx: Tx, user: SessionUser, id: string, accountId: unknown, now: Date): Promise<InvoiceView> {
  const fields = new Fields();
  if (accountId === undefined) fields.fail("account_id", "Choose an account");
  const account = accountId === undefined ? null : await findAccount(tx, user.companyId, accountId, false);
  fields.raise();
  if (!account) throw new Error("unreachable: validated account");
  const invoice = await lockInvoice(tx, user.companyId, id);
  if (invoice.status === "paid") throw refusal(409, "invoice_already_paid");
  if (invoice.status === "draft") throw refusal(409, "invoice_not_sent");
  await findAccount(tx, user.companyId, account.id, true);
  await recordTransaction(tx, {
    companyId: user.companyId,
    accountId: account.id,
    direction: "credit",
    amountCents: invoice.total_cents,
    method: "ach",
    counterparty: invoice.customer_name,
    memo: null,
    transferId: null,
    createdAt: now,
  });
  const updated = await tx.query("UPDATE invoices SET status = 'paid', paid_into_account_id = $2 WHERE id = $1 RETURNING *", [id, account.id]);
  await appendAudit(tx, user.companyId, "invoice.paid", null, invoice.total_cents, user.email);
  return invoiceView(updated.rows[0]);
}
