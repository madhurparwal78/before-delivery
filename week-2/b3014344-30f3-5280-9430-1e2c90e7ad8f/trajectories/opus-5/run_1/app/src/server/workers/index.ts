import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { query, queryOne, withTransaction } from "../db.js";
import { studioDate } from "../time.js";
import * as killbill from "../services/killbill.js";
import * as storage from "../services/storage.js";
import { sendMessage } from "../services/mail.js";
import { dunningMessage, invoiceNoticeMessage, queueMessage } from "../mailer.js";
import { invoicePdf } from "../pdf.js";
import { chargeOpenInvoice, classifyInvoices, registerInvoice } from "../domain/billing.js";
import { cardApproves } from "../domain/cards.js";
import { orderById } from "../domain/orders.js";
import { accountById, ownerOfAccount } from "../domain/accounts.js";

const MAIL_BATCH = 20;

async function runMailQueue(): Promise<void> {
  const claimed = await withTransaction(async (client) => {
    const rows = await client.query<{ id: string; to_email: string; subject: string; body: string }>(
      `select id, to_email, subject, body from mail_queue
        where sent_at is null and (last_attempt_at is null or last_attempt_at < now() - interval '4 seconds')
        order by queued_at asc limit ${MAIL_BATCH} for update skip locked`,
    );
    if (rows.rows.length > 0) {
      await client.query(
        `update mail_queue set attempts = attempts + 1, last_attempt_at = now() where id = any($1::uuid[])`,
        [rows.rows.map((row) => row.id)],
      );
    }
    return rows.rows;
  });
  for (const message of claimed) {
    try {
      await sendMessage({ to: message.to_email, subject: message.subject, body: message.body });
      await query(`update mail_queue set sent_at = now() where id = $1`, [message.id]);
    } catch {
      /* the queue retries this message on the next pass */
    }
  }
}

interface BillingAccount {
  id: string;
  killbill_account_id: string;
  currency: string;
  card_last4: string | null;
}

async function storeInvoicePdf(input: {
  invoiceId: string;
  orderId: string;
  accountId: string;
}): Promise<void> {
  const order = await orderById(input.orderId);
  const account = await accountById(input.accountId);
  if (!order || !account) return;
  const invoice = await killbill.getInvoice(input.invoiceId);
  const bytes = invoicePdf({
    invoice,
    businessName: account.businessName,
    orderNumber: order.number,
  });
  await storage.putObject(storage.invoicePdfKey(order.id, invoice.invoiceId), bytes);
  await query(`update invoice_tasks set pdf_stored_at = now() where killbill_invoice_id = $1`, [
    invoice.invoiceId,
  ]);
}

async function scheduleAttempt(input: {
  orderId: string;
  invoiceId: string;
  attemptNo: number;
  dueAt: Date;
}): Promise<void> {
  await query(
    `insert into dunning_attempts (id, order_id, killbill_invoice_id, attempt_no, due_at)
     values ($1, $2, $3, $4, $5) on conflict (killbill_invoice_id, attempt_no) do nothing`,
    [randomUUID(), input.orderId, input.invoiceId, input.attemptNo, input.dueAt.toISOString()],
  );
}

async function runDunning(input: {
  account: BillingAccount;
  invoice: killbill.KbInvoice;
  orderId: string;
}): Promise<void> {
  const order = await orderById(input.orderId);
  const owner = await ownerOfAccount(input.account.id);
  if (!order || !owner || input.invoice.balance.minor <= 0n) return;
  const due = await withTransaction(async (client) => {
    const rows = await client.query<{ id: string; attempt_no: number }>(
      `select id, attempt_no from dunning_attempts
        where killbill_invoice_id = $1 and ran_at is null and due_at <= now()
        order by attempt_no asc limit 1 for update skip locked`,
      [input.invoice.invoiceId],
    );
    const row = rows.rows[0];
    if (!row) return null;
    await client.query(`update dunning_attempts set ran_at = now() where id = $1`, [row.id]);
    return row;
  });
  if (!due) return;

  if (cardApproves(input.account.card_last4)) {
    await chargeOpenInvoice({
      order,
      killbillAccountId: input.account.killbill_account_id,
      ownerEmail: owner.email,
      invoice: input.invoice,
      kind: "renewal",
      paymentExternalKey: `${input.invoice.invoiceId}-renewal`,
    });
    await query(`update dunning_attempts set outcome = 'paid' where id = $1`, [due.id]);
    await query(`delete from dunning_attempts where killbill_invoice_id = $1 and ran_at is null`, [
      input.invoice.invoiceId,
    ]);
    return;
  }

  await query(`update dunning_attempts set outcome = 'failed' where id = $1`, [due.id]);
  const first = await queryOne<{ ran_at: Date }>(
    `select ran_at from dunning_attempts where killbill_invoice_id = $1 and attempt_no = 1`,
    [input.invoice.invoiceId],
  );
  const firstRanAt = first?.ran_at ?? new Date();
  let nextDue: Date | null = null;
  if (due.attempt_no === 1) {
    nextDue = new Date(firstRanAt.getTime() + 3 * config.durations.dunningDaySeconds * 1000);
    await scheduleAttempt({ orderId: order.id, invoiceId: input.invoice.invoiceId, attemptNo: 2, dueAt: nextDue });
  } else if (due.attempt_no === 2) {
    nextDue = new Date(firstRanAt.getTime() + 7 * config.durations.dunningDaySeconds * 1000);
    await scheduleAttempt({ orderId: order.id, invoiceId: input.invoice.invoiceId, attemptNo: 3, dueAt: nextDue });
  }
  await queueMessage(
    null,
    dunningMessage({
      to: owner.email,
      invoiceId: input.invoice.invoiceId,
      attempt: due.attempt_no,
      amount: input.invoice.balance,
      nextRetryDate: nextDue ? studioDate(nextDue) : null,
    }),
  );
  if (due.attempt_no === 3 && order.careSubscriptionId) {
    await killbill.cancelSubscription(order.careSubscriptionId, true);
  }
}

async function runBillingForAccount(account: BillingAccount): Promise<void> {
  const invoices = await killbill.listInvoices(account.killbill_account_id);
  const classified = await classifyInvoices(account.id, invoices);
  const owner = await ownerOfAccount(account.id);
  for (const item of classified) {
    if (!item.orderId) continue;
    await registerInvoice({
      invoice: item.invoice,
      accountId: account.id,
      orderId: item.orderId,
      kind: item.kind,
    });
    const task = await queryOne<{ notice_sent_at: Date | null; pdf_stored_at: Date | null }>(
      `select notice_sent_at, pdf_stored_at from invoice_tasks where killbill_invoice_id = $1`,
      [item.invoice.invoiceId],
    );
    if (item.invoice.status !== "VOID" && !task?.pdf_stored_at) {
      await storeInvoicePdf({
        invoiceId: item.invoice.invoiceId,
        orderId: item.orderId,
        accountId: account.id,
      });
    }
    const order = await orderById(item.orderId);
    const unpaidRenewal =
      item.kind === "renewal" &&
      item.invoice.status !== "VOID" &&
      item.invoice.balance.minor > 0n &&
      order?.state === "paid_in_full";
    if (unpaidRenewal && owner) {
      const claimed = await query<{ killbill_invoice_id: string }>(
        `update invoice_tasks set notice_sent_at = now()
          where killbill_invoice_id = $1 and notice_sent_at is null returning killbill_invoice_id`,
        [item.invoice.invoiceId],
      );
      if (claimed.length > 0) {
        await queueMessage(
          null,
          invoiceNoticeMessage({
            to: owner.email,
            invoiceId: item.invoice.invoiceId,
            invoiceNumber: item.invoice.invoiceNumber,
            amount: item.invoice.amount,
            due: item.invoice.balance,
          }),
        );
      }
      await scheduleAttempt({
        orderId: item.orderId,
        invoiceId: item.invoice.invoiceId,
        attemptNo: 1,
        dueAt: new Date(),
      });
      await runDunning({ account, invoice: item.invoice, orderId: item.orderId });
    }
  }
}

/** Runs every dunning attempt that has fallen due, on its own quick loop. */
async function runDueDunning(): Promise<void> {
  const due = await query<{ order_id: string; killbill_invoice_id: string }>(
    `select distinct order_id, killbill_invoice_id from dunning_attempts
      where ran_at is null and due_at <= now() limit 10`,
  );
  for (const row of due) {
    const account = await queryOne<BillingAccount>(
      `select a.id, a.killbill_account_id, a.currency, a.card_last4
         from client_accounts a join orders o on o.account_id = a.id
        where o.id = $1 and a.killbill_account_id is not null`,
      [row.order_id],
    );
    if (!account) continue;
    try {
      const invoice = await killbill.getInvoice(row.killbill_invoice_id);
      await runDunning({ account, invoice, orderId: row.order_id });
    } catch {
      /* billing is unreachable; the attempt runs as soon as it returns */
    }
  }
}

async function runBilling(): Promise<void> {
  const accounts = await query<BillingAccount>(
    `select id, killbill_account_id, currency, card_last4 from client_accounts
      where killbill_account_id is not null`,
  );
  for (const account of accounts) {
    try {
      await runBillingForAccount(account);
    } catch {
      /* an unreachable service is retried on the next pass */
    }
  }
}

/** Jittered so two processes sharing the ledger never lock into the same polling phase. */
function loop(name: string, everyMs: number, run: () => Promise<void>): void {
  const schedule = (): void => {
    const timer = setTimeout(() => void tick(), everyMs * (0.6 + Math.random() * 0.8));
    timer.unref();
  };
  const tick = async (): Promise<void> => {
    try {
      await run();
    } catch (error) {
      process.stderr.write(`${name} worker: ${(error as Error).message}\n`);
    } finally {
      schedule();
    }
  };
  void tick();
}

export function startWorkers(): void {
  loop("mail", 3000, runMailQueue);
  loop("dunning", 1000, runDueDunning);
  loop("billing", 4000, runBilling);
}
