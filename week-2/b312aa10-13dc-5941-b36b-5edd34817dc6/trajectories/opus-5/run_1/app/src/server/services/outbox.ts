/**
 * Queued Kill Bill items, account names, mail and sanitation PDFs. Delivery is
 * retried until it succeeds, in the order it was queued for each member.
 */
import { sendDueExpiryNotices } from '../api/notices.js';
import { db } from '../db/pool.js';
import { storePendingSeedObjects } from '../db/seed.js';
import { allKitchens, allMembers } from '../store/kitchens.js';
import {
  BillingUnavailable,
  commitInvoice,
  ensureAccount,
  invoiceState,
  postCharge,
  postCredit,
  setAccountName,
} from './killbill.js';
import { sendMail } from './mail.js';
import { renderSanitationPdf } from './sanitationPdf.js';
import { putObject, sanitationKey, StorageUnavailable } from './storage.js';

type PendingItem = {
  id: string;
  member_id: string;
  month: string;
  amount_cents: number;
  description: string;
  line_kind: string;
  filed_date: string;
};

async function accountFor(memberId: string): Promise<string> {
  const existing = await db().query<{ account_id: string | null }>(
    `select account_id from kb_accounts where member_id = $1`,
    [memberId],
  );
  const stored = existing.rows[0]?.account_id;
  if (stored) return stored;
  const members = await allMembers();
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) throw new BillingUnavailable();
  const accountId = await ensureAccount(member.id, member.businessName);
  await db().query(
    `insert into kb_accounts (member_id, account_id) values ($1,$2)
     on conflict (member_id) do update set account_id = $2`,
    [memberId, accountId],
  );
  return accountId;
}

/** The member's single draft invoice for a month. */
export async function invoiceIdFor(memberId: string, month: string): Promise<string | null> {
  const found = await db().query<{ invoice_id: string }>(
    `select invoice_id from kb_invoices where member_id = $1 and month = $2`,
    [memberId, month],
  );
  return found.rows[0]?.invoice_id ?? null;
}

async function rememberInvoice(
  memberId: string,
  month: string,
  invoiceId: string,
): Promise<void> {
  await db().query(
    `insert into kb_invoices (member_id, month, invoice_id) values ($1,$2,$3)
     on conflict (member_id, month) do nothing`,
    [memberId, month, invoiceId],
  );
}

async function deliverItem(item: PendingItem): Promise<void> {
  const accountId = await accountFor(item.member_id);
  const invoiceId = await invoiceIdFor(item.member_id, item.month);
  const posted =
    item.amount_cents < 0
      ? await postCredit(accountId, invoiceId, item.amount_cents, item.description)
      : await postCharge(
          accountId,
          invoiceId,
          item.amount_cents,
          item.description,
          `${item.month}-01`,
        );
  await rememberInvoice(item.member_id, item.month, posted.invoiceId);
  await db().query(
    `update billing_items set recorded_at = now(), kb_item_id = $2 where id = $1`,
    [item.id, posted.itemId],
  );
}

async function pendingItems(memberId: string | null, limit: number): Promise<PendingItem[]> {
  const result = await db().query<PendingItem>(
    `select id, member_id, month, amount_cents, description, line_kind, filed_date
       from billing_items
      where recorded_at is null and ($1::text is null or member_id = $1)
      order by seq asc limit $2`,
    [memberId, limit],
  );
  return result.rows;
}

/** Records the items of one member, oldest first, within a time budget. */
export async function flushMember(memberId: string, deadlineMs: number): Promise<void> {
  for (;;) {
    if (Date.now() >= deadlineMs) return;
    const items = await pendingItems(memberId, 20);
    if (items.length === 0) return;
    for (const item of items) {
      if (Date.now() >= deadlineMs) return;
      await deliverItem(item);
    }
  }
}

export async function flushMemberQuietly(memberId: string, budgetMs: number): Promise<void> {
  try {
    await flushMember(memberId, Date.now() + budgetMs);
  } catch {
    // Left queued; the worker retries it.
  }
}

async function flushAllBilling(): Promise<void> {
  const items = await pendingItems(null, 200);
  const byMember = new Map<string, PendingItem[]>();
  for (const item of items) {
    const list = byMember.get(item.member_id) ?? [];
    list.push(item);
    byMember.set(item.member_id, list);
  }
  for (const [, list] of byMember) {
    for (const item of list) {
      try {
        await deliverItem(item);
      } catch {
        break;
      }
    }
  }
}

async function flushAccountNames(): Promise<void> {
  const result = await db().query<{ seq: string; member_id: string; name: string }>(
    `select seq, member_id, name from kb_name_updates where done_at is null order by seq limit 50`,
  );
  for (const row of result.rows) {
    try {
      const accountId = await accountFor(row.member_id);
      await setAccountName(accountId, row.name);
      await db().query(`update kb_name_updates set done_at = now() where seq = $1`, [row.seq]);
    } catch {
      return;
    }
  }
}

async function flushMail(): Promise<void> {
  const result = await db().query<{ seq: string; to_email: string; subject: string; body: string }>(
    `select seq, to_email, subject, body from mail_outbox where sent_at is null
      order by seq limit 50`,
  );
  for (const row of result.rows) {
    try {
      await sendMail(row.to_email, row.subject, row.body);
      await db().query(`update mail_outbox set sent_at = now() where seq = $1`, [row.seq]);
    } catch {
      await db().query(`update mail_outbox set attempts = attempts + 1 where seq = $1`, [row.seq]);
      return;
    }
  }
}

export async function flushMailNow(): Promise<void> {
  await flushMail().catch(() => undefined);
}

async function flushSanitationReports(): Promise<void> {
  const queued = await db().query<{ kitchen_id: string; month: string }>(
    `select kitchen_id, month from sanitation_reports where status = 'queued'`,
  );
  if (queued.rows.length === 0) return;
  const kitchens = await allKitchens();
  for (const row of queued.rows) {
    const kitchen = kitchens.find((candidate) => candidate.id === row.kitchen_id);
    if (!kitchen) continue;
    try {
      const pdf = await renderSanitationPdf(kitchen, row.month);
      await putObject(sanitationKey(kitchen.id, row.month), pdf, 'application/pdf');
      await db().query(
        `update sanitation_reports set status = 'stored', stored_at = now()
          where kitchen_id = $1 and month = $2`,
        [kitchen.id, row.month],
      );
    } catch (error) {
      if (error instanceof StorageUnavailable) return;
    }
  }
}

async function ensureAccounts(): Promise<void> {
  const missing = await db().query<{ member_id: string }>(
    `select member_id from kb_accounts where account_id is null`,
  );
  for (const row of missing.rows) {
    try {
      await accountFor(row.member_id);
    } catch {
      return;
    }
  }
}

/** Commits the member's draft invoice for a month; an invoice already committed is left alone. */
export async function commitMonthInvoice(memberId: string, month: string): Promise<void> {
  const invoiceId = await invoiceIdFor(memberId, month);
  if (invoiceId === null) return;
  const state = await invoiceState(invoiceId);
  if (state === null || state.status !== 'DRAFT') return;
  await commitInvoice(invoiceId);
  await db().query(
    `update kb_invoices set committed = true where member_id = $1 and month = $2`,
    [memberId, month],
  );
}

/** The Kill Bill amount of the member's invoice for a month, read back. */
export async function killBillAmountFor(memberId: string, month: string): Promise<number> {
  const invoiceId = await invoiceIdFor(memberId, month);
  if (invoiceId === null) return 0;
  return (await invoiceState(invoiceId))?.amountCents ?? 0;
}

let running = false;

export function startWorker(): void {
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await ensureAccounts();
      await flushAllBilling();
      await flushAccountNames();
      await flushMail();
      await flushSanitationReports();
      await storePendingSeedObjects();
      await sendDueExpiryNotices();
    } catch {
      // Every step retries on the next tick.
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 5000);
  void tick();
}
