import type { PoolClient } from "pg";
import type { App } from "../http.js";
import { query, withTransaction, type Row } from "../db.js";
import { recordKbTransaction, PaymentUnavailable } from "./kb.js";
import { euroCents } from "../../shared/money.js";
import { formatDate } from "../../shared/time.js";

export async function orgKbAccountId(app: App, client: PoolClient, organisationId: string): Promise<string | null> {
  const res = await client.query("select kb_account_id from kb_accounts where organisation_id = $1 limit 1", [organisationId]);
  const row = res.rows[0];
  if (!row) return null;
  return String(row.kb_account_id);
}

// Each collection is a payment on the invoice, external key
// <invoice number>-<attempt number>. Retries are scheduled at 1, 3 and 7
// billing days after the invoice's first recorded return.
export async function collectInvoice(app: App, client: PoolClient, invoice: Row): Promise<boolean> {
  const attempt = Number(invoice.retries_used) + 1;
  const balance = Number(invoice.balance_cents);
  if (balance <= 0) {
    await client.query("update invoices set status = 'paid', balance_cents = 0 where id = $1", [String(invoice.id)]);
    return true;
  }
  const accountId = await orgKbAccountId(app, client, String(invoice.organisation_id));
  if (!accountId) return false;
  const paymentKey = `${String(invoice.number)}-${attempt}`;
  try {
    const payment = await app.killbill.purchase(accountId, paymentKey, paymentKey, balance);
    await recordKbTransaction(client, payment.transactionId, "PURCHASE", balance, paymentKey, null, payment.paymentId);
    const wasFailed = String(invoice.status) === "payment_failed";
    await client.query(
      `update invoices set paid_cents = paid_cents + $2, balance_cents = amount_cents - credited_cents - (paid_cents + $2),
         retries_used = retries_used + 1, next_retry_at = null,
         status = case when $3 then 'retried' else 'paid' end
       where id = $1`,
      [String(invoice.id), balance, wasFailed],
    );
    await client.query(
      "insert into audit (actor, actor_role, action, target_type, target_id) values ('system','system','invoice_collected','invoice',$1)",
      [String(invoice.number)],
    );
    if (wasFailed) {
      // A successful retry stands for 2 billing days before it counts as paid.
      await client.query("update invoices set next_retry_at = now() + ($2 || ' seconds')::interval where id = $1", [
        String(invoice.id),
        String(2 * app.config.billingDaySeconds),
      ]);
    }
    return true;
  } catch (e) {
    if (e instanceof PaymentUnavailable) return false;
    return false;
  }
}

// A retried invoice with no return for 2 billing days is paid.
export async function settleRetriedInvoice(app: App, invoice: Row): Promise<void> {
  await query("update invoices set status = 'paid', next_retry_at = null where id = $1", [String(invoice.id)]);
  await query(
    "insert into audit (actor, actor_role, action, target_type, target_id) values ('system','system','invoice_settled','invoice',$1)",
    [String(invoice.number)],
  );
  void app;
}

// A bank return is a CHARGEBACK of the collected amount on the latest collection.
export async function recordBankReturn(app: App, client: PoolClient, invoice: Row, note: string, actor: { email: string; role: string }): Promise<"retried_schedule" | "written_off"> {
  const lastCollection = await client.query(
    "select * from kb_transactions where external_key like $1 order by id desc limit 1",
    [`${String(invoice.number)}-%`],
  );
  const last = lastCollection.rows[0];
  const returnedCents = last ? Number(last.amount_cents) : 0;
  if (last && last.payment_id) {
    try {
      const tx = await app.killbill.completeTransaction(String(last.payment_id), "CHARGEBACK", `${String(last.external_key)}-return`, returnedCents);
      await recordKbTransaction(client, tx, "CHARGEBACK", returnedCents, `${String(last.external_key)}-return`, String(invoice.order_id), String(last.payment_id));
    } catch {
      // The sweep retries the chargeback; the return is already recorded.
    }
  }
  const retries = Number(invoice.retries_used);
  await client.query(
    "update invoices set paid_cents = greatest(paid_cents - $2, 0), balance_cents = amount_cents - credited_cents - greatest(paid_cents - $2, 0) where id = $1",
    [String(invoice.id), returnedCents],
  );
  if (retries >= 3) {
    await client.query("update invoices set status = 'written_off', next_retry_at = null where id = $1", [String(invoice.id)]);
    await client.query(
      "insert into audit (actor, actor_role, action, target_type, target_id, detail) values ($1,$2,'invoice_written_off','invoice',$3,$4)",
      [actor.email, actor.role, String(invoice.number), note],
    );
    return "written_off";
  }
  const firstReturnAt = invoice.first_return_at ? new Date(String(invoice.first_return_at)) : new Date();
  const delays = [1, 3, 7];
  const delay = delays[Math.min(retries, 2)];
  const nextRetry = new Date(firstReturnAt.getTime() + delay * app.config.billingDaySeconds * 1000);
  await client.query(
    "update invoices set status = 'payment_failed', first_return_at = $2, next_retry_at = $3 where id = $1",
    [String(invoice.id), firstReturnAt, nextRetry],
  );
  await client.query(
    "insert into audit (actor, actor_role, action, target_type, target_id, detail) values ($1,$2,'bank_return_recorded','invoice',$3,$4)",
    [actor.email, actor.role, String(invoice.number), note],
  );
  return "retried_schedule";
}

export async function queueBankReturnMail(app: App, client: PoolClient, invoice: Row, outcome: "retried_schedule" | "written_off"): Promise<void> {
  const orderRes = await client.query("select * from orders where id = $1", [String(invoice.order_id)]);
  const order = orderRes.rows[0];
  const buyerRes = await client.query("select * from users where id = $1", [Number(order.buyer_id)]);
  const body = outcome === "written_off"
    ? `Payment returned — invoice ${String(invoice.number)}. The invoice is written off.`
    : `Payment returned — invoice ${String(invoice.number)}. Next retry on ${formatDate(String(invoice.next_retry_at).slice(0,10))}.`;
  await app.queueMail(client, "bank_return", String(buyerRes.rows[0].email), `Payment returned — invoice ${String(invoice.number)}`, body, [], String(order.id));
}

export async function collectDueInvoices(app: App): Promise<void> {
  const due = await query("select * from invoices where status = 'issued' and due_at <= now()");
  for (const invoice of due.rows) {
    await withTransaction(async (client) => {
      const lock = await client.query("select * from invoices where id = $1 for update", [String(invoice.id)]);
      if (String(lock.rows[0].status) !== "issued") return;
      await collectInvoice(app, client, lock.rows[0]);
    });
  }
  const retries = await query("select * from invoices where status = 'payment_failed' and next_retry_at <= now()");
  for (const invoice of retries.rows) {
    await withTransaction(async (client) => {
      const lock = await client.query("select * from invoices where id = $1 for update", [String(invoice.id)]);
      if (String(lock.rows[0].status) !== "payment_failed") return;
      await collectInvoice(app, client, lock.rows[0]);
    });
  }
  const settled = await query("select * from invoices where status = 'retried' and next_retry_at <= now()");
  for (const invoice of settled.rows) {
    await withTransaction(async (client) => {
      const lock = await client.query("select * from invoices where id = $1 for update", [String(invoice.id)]);
      if (String(lock.rows[0].status) !== "retried") return;
      await settleRetriedInvoice(app, lock.rows[0]);
    });
  }
}

export function euro(n: number): string {
  return euroCents(n);
}
