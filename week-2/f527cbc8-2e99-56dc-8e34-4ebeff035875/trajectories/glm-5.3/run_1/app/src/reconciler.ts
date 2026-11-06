import { connectDb, withTx, type Tx, type Row } from './db.js';
import { config } from './config.js';
import { now, businessDate, practiceZoneName, todayInPractice } from './time.js';
import { queueEmail, trySend } from './mail.js';
import { enqueueJob, claimJob, finishJob, failJob } from './jobs.js';
import * as kb from './killbill.js';
import { newId, sweepDay, offerPass } from './domain.js';
import { audit, systemActor } from './audit.js';
import { emails as T } from './email-templates.js';
import { nextDueState } from './nextdue.js';
import { ledgerEntry } from './ledger.js';

let stopped = false;

/**
 * Background reconciler: pending invoices after the hold-off, queued emails,
 * offer passes and due reminders. Each passes through the shared job claiming
 * so work is done exactly once across instances.
 */
export function startReconciler(): void {
  stopped = false;
  const loop = setInterval(async () => {
    if (stopped) return;
    try {
      await sendQueuedEmails();
      await reconcilePendingInvoices();
      await reconcilePendingRefunds();
      await enqueueOfferPasses();
      await enqueueDueReminders();
    } catch {
      // the next tick retries
    }
  }, 5000);
  loop.unref?.();
  const offerLoop = setInterval(async () => {
    if (stopped) return;
    try {
      await runOfferPasses();
    } catch { /* next tick */ }
  }, 5000);
  offerLoop.unref?.();
}

export function stopReconciler(): void {
  stopped = true;
}

/** Email outbox delivery with the published hold-offs (Email outage). */
async function sendQueuedEmails(): Promise<void> {
  const t = now();
  const due = await connectDb().query(
    `select * from emails where sent_at is null
       and (last_attempt_at is null or last_attempt_at <= $1::timestamptz - interval '20 seconds')
       and (claimed_by is null or claim_expires_at <= $2)
     order by created_at limit 5`,
    [t, t]
  );
  for (const e of due.rows) {
    const email = e as unknown as { id: string; to_addr: string; subject: string; body: string; request_claimed: boolean; claimed_by: string | null };
    const claimed = await withTx(async tx => {
      const rows = await tx.query(`select * from emails where id = $1 for update`, [email.id]);
      if (rows.length === 0) return false;
      const row = rows[0];
      if (row.sent_at) return false;
      if (row.claimed_by && row.claimed_by !== config.instanceLabel && row.claim_expires_at && row.claim_expires_at.getTime() > t.getTime()) return false;
      if (row.claimed_by === config.instanceLabel && row.last_attempt_at && t.getTime() - row.last_attempt_at.getTime() < 20000) return false;
      await tx.query(`update emails set claimed_by = $2, claim_expires_at = $3 where id = $1`, [email.id, config.instanceLabel, new Date(t.getTime() + config.jobLeaseSeconds * 1000)]);
      return true;
    });
    if (!claimed) continue;
    const ok = await trySend({ to: email.to_addr, subject: email.subject, body: email.body });
    if (ok) {
      await withTx(tx => tx.query(`update emails set sent_at = $2, claimed_by = null, claim_expires_at = null where id = $1`, [email.id, now()]));
    } else {
      await withTx(tx => tx.query(`update emails set last_attempt_at = $2, attempts = attempts + 1, claimed_by = null, claim_expires_at = null where id = $1`, [email.id, now()]));
    }
  }
}

/** Retry hold-off for pending invoices, then push them to Kill Bill (Billing outage). */
async function reconcilePendingInvoices(): Promise<void> {
  const t = now();
  const rows = await connectDb().query(
    `select i.*, v.status as visit_status, v.id as visit_id2 from invoices i
     left join visits v on v.invoice_id = i.id
     where i.status = 'pending' and i.pending_since <= $1::timestamptz - interval '20 seconds'
     limit 3`,
    [t]
  );
  for (const inv of rows.rows) {
    try {
      const owner = (await withTx(tx => tx.query(`select * from users where id = $1`, [inv.owner_id])))[0];
      const horse = (await withTx(tx => tx.query(`select * from horses where id = $1`, [inv.horse_id])))[0];
      const accountId = await kb.ensureAccount(owner.email, owner.name);
      const items = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items;
      const charges = items.filter((i: { amount_cents: number }) => i.amount_cents > 0)
        .map((i: { description: string; amount_cents: number }) => ({ description: `${i.description} [${inv.id}]`, amount_cents: i.amount_cents }));
      let kbInvoiceId = await kb.findInvoiceIdByMarker(accountId, `[${inv.id}]`);
      if (!kbInvoiceId) {
        const created = await kb.createInvoiceWithCharges(accountId, String(inv.business_date).slice(0, 10), charges);
        kbInvoiceId = created.invoiceId;
      }
      const creditItem = items.find((i: { amount_cents: number }) => i.amount_cents < 0);
      if (creditItem && inv.booking_id) {
        const booking = (await withTx(tx => tx.query(`select * from bookings where id = $1`, [inv.booking_id])))[0];
        if (booking?.payment_id) {
          const credit = -creditItem.amount_cents;
          const depositIn = await kb.createExternalPayment(kbInvoiceId!, accountId, credit, `${inv.id}:deposit-in`, `${inv.id}:deposit-in`).catch(() => null);
          if (depositIn?.paymentId) {
            await kb.transferDepositCreditOut(accountId, kbInvoiceId!, depositIn.paymentId, credit, `${inv.id}:deposit-out`).catch(() => {});
          }
        }
      }
      const balance = await kb.getInvoiceBalance(kbInvoiceId!);
      await withTx(async tx => {
        const gross = items.filter((i: { amount_cents: number }) => i.amount_cents > 0).reduce((s: number, i: { amount_cents: number }) => s + i.amount_cents, 0);
        const invoice = (await tx.query(`select * from invoices where id = $1 for update`, [inv.id]))[0];
        if (invoice.status !== 'pending') return;
        await ledgerEntry(tx, 'billed', gross, now(), inv.owner_id, inv.horse_id, String(inv.business_date).slice(0, 10), inv.id, null);
        await tx.query(`update invoices set killbill_invoice_id = $2, status = 'unpaid', balance_cents = $3, pending_since = null where id = $1`, [inv.id, kbInvoiceId, balance?.balance ?? inv.total_cents]);
        await tx.query(`update visits set status = 'invoiced' where invoice_id = $1`, [inv.id]);
        await audit(tx, systemActor(), 'invoiced', 'invoice', inv.id, 'pending', 'unpaid', 'reconciler');
      });
      // Visit summary email for visit invoices.
      if (inv.visit_id2) {
        const visit = (await withTx(tx => tx.query(`select * from visits where id = $1`, [inv.visit_id2])))[0];
        if (visit) {
          const visits = await withTx(tx => tx.query(`select business_date, status from visits where horse_id = $1 order by business_date desc, created_at desc`, [inv.horse_id]));
          const lastWorked = visits.find((vv: Row) => vv.status !== 'open')?.business_date ?? null;
          const nextDue = nextDueState(lastWorked, horse.cycle_weeks).next_due_date;
          const msg = T.visitSummaryEmail(horse.name, String(inv.business_date).slice(0, 10), items, inv.total_cents, nextDue);
          await withTx(tx => queueEmail(tx, { to: owner.email, subject: msg.subject, body: msg.body }, false));
        }
      }
    } catch {
      // retry on the next pass, at least every 15 seconds
    }
  }
}

/** Push refunds that could not reach Kill Bill when they happened. */
async function reconcilePendingRefunds(): Promise<void> {
  const t = now();
  const rows = await connectDb().query(
    `select r.*, p.owner_id, p.killbill_payment_id from refunds r join payments p on p.id = r.payment_id
     where r.killbill_status = 'pending' and r.pending_since <= $1::timestamptz - interval '20 seconds' limit 3`,
    [t]
  );
  for (const r of rows.rows) {
    try {
      const owner = (await withTx(tx => tx.query(`select * from users where id = $1`, [r.owner_id])))[0];
      const accountId = await kb.ensureAccount(owner.email, owner.name);
      if (r.killbill_payment_id) {
        const inv = (await connectDb().query(`select killbill_invoice_id from invoices where id = (select invoice_id from payments where id = $1)`, [r.payment_id])).rows[0];
        await kb.createRefund(accountId, r.killbill_payment_id, inv?.killbill_invoice_id ?? '', r.amount_cents, r.id);
        await withTx(tx => tx.query(`update refunds set killbill_status = 'recorded', pending_since = null, ledger_at = $2 where id = $1`, [r.id, now()]));
      }
    } catch {
      // next pass
    }
  }
}

/** The 5-second offer-pass job for days nobody reads (Waitlist, No job needed). */
async function enqueueOfferPasses(): Promise<void> {
  const rows = await connectDb().query(
    `select distinct d.id from barn_days d
     join waitlist w on w.barn_day_id = d.id
     where d.status = 'published' and d.starts_at > $1`,
    [now()]
  );
  for (const d of rows.rows) {
    const existing = await connectDb().query(
      `select 1 from jobs where kind = 'offer_pass' and status in ('queued','running') and params->>'day_id' = $1`,
      [d.id]
    );
    if (existing.rows.length === 0) {
      await withTx(tx => enqueueJob(tx, 'offer_pass', now(), { day_id: d.id }));
    }
  }
}

async function runOfferPasses(): Promise<void> {
  // Handled by the shared job worker loop.
}

/** One due_reminder job per horse per next-due date (DP-78). */
async function enqueueDueReminders(): Promise<void> {
  const horses = await connectDb().query(`select h.*, (select business_date from visits v where v.horse_id = h.id and v.status <> 'open' order by business_date desc, created_at desc limit 1) as last_worked from horses h`);
  for (const h of horses.rows) {
    if (!h.last_worked) continue;
    const due = nextDueState(String(h.last_worked).slice(0, 10), h.cycle_weeks);
    if (due.due_status !== 'due' || !due.next_due_date) continue;
    const already = await connectDb().query(
      `select 1 from due_reminders where horse_id = $1 and next_due_date = $2`,
      [h.id, due.next_due_date]
    );
    if (already.rows.length === 0) {
      await withTx(async tx => {
        await tx.query(
          `insert into due_reminders(horse_id, next_due_date) values($1,$2) on conflict do nothing`,
          [h.id, due.next_due_date]
        );
        await enqueueJob(tx, 'due_reminder', now(), { horse_id: h.id, next_due_date: due.next_due_date });
      });
    }
  }
}

/** Returns request-queued emails claimed by this instance without an attempt (drain, DP-85). */
export async function releaseClaimedEmails(): Promise<void> {
  await withTx(tx => tx.query(
    `update emails set claimed_by = null, claim_expires_at = null where claimed_by = $1 and sent_at is null and last_attempt_at is null`,
    [config.instanceLabel]
  )).catch(() => {});
}
