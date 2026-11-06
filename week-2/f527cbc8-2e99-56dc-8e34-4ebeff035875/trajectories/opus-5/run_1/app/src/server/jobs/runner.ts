import { config } from '../config.js';
import { now } from '../clock.js';
import { query, queryOne, withClient, withTransaction, type Db } from '../db.js';
import { newId, dollars } from '../util.js';
import { log } from '../log.js';
import { systemActor } from '../audit.js';
import { pumpOutboxOnce } from '../services/mail.js';
import { queueBackgroundEmail } from '../services/mail.js';
import { dueReminderEmail } from '../services/emails.js';
import { deleteObject, getObject, objectKeys, putObject } from '../services/storage.js';
import { makeThumbnail } from '../services/images.js';
import { signExportPath, pruneSigningKeys } from '../services/signing.js';
import { practice } from '../domain/practice.js';
import { businessDateAt, formatInstant, monthAt } from '../domain/time.js';
import { nextDue } from '../domain/nextdue.js';
import { finishInvoiceInKillBill, pendingInvoiceIds, loadInvoice } from '../domain/invoicing.js';
import { recordDecline, clearDunning } from '../domain/dunning.js';
import { prepareDay } from '../domain/dayengine.js';
import { chargeCard, isHardDecline } from '../domain/cards.js';
import { writeLedger } from '../domain/ledger.js';
import { writeAudit } from '../audit.js';
import * as killbill from '../services/killbill.js';
import { KillBillUnavailable } from '../services/killbill.js';

/**
 * The durable job queue. A due job is claimed through Postgres by one instance, backs
 * off on failure, goes dead at the attempt limit, and a superseded worker's result is
 * discarded.
 */
export type JobKind = 'thumbnail' | 'dunning_retry' | 'due_reminder' | 'offer_pass' | 'csv_export';

interface ClaimedJob {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  lease_holder: string;
}

const LEASE_HOLDER = `${config.instanceLabel}:${newId()}`;

async function claimJob(db: Db, at: Date): Promise<ClaimedJob | null> {
  // A running job whose lease has expired is reclaimed by any instance, and that
  // counts as an attempt.
  return await queryOne<ClaimedJob>(
    db,
    `UPDATE jobs SET status = 'running', attempts = attempts + 1,
                     lease_expires_at = $1, lease_holder = $2, updated_at = $3
     WHERE id = (
       SELECT id FROM jobs
       WHERE (status = 'queued' AND run_at <= $3)
          OR (status = 'running' AND lease_expires_at <= $3)
       ORDER BY run_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, kind, payload, attempts, lease_holder`,
    [new Date(at.getTime() + config.jobLeaseSeconds * 1000), LEASE_HOLDER, at],
  );
}

async function succeed(job: ClaimedJob, result: unknown): Promise<void> {
  await withTransaction(async (db) => {
    // A result from a worker whose lease was taken over is discarded.
    await query(
      db,
      `UPDATE jobs SET status = 'succeeded', result = COALESCE($2::jsonb, result),
                       lease_expires_at = NULL, updated_at = $3
       WHERE id = $1 AND lease_holder = $4`,
      [job.id, result === undefined ? null : JSON.stringify(result), now(), job.lease_holder],
    );
  });
}

async function fail(job: ClaimedJob, error: unknown): Promise<void> {
  const at = now();
  const backoff = Math.min(
    config.jobBackoffBaseSeconds * 2 ** (job.attempts - 1),
    config.jobBackoffMaxSeconds,
  );
  const dead = job.attempts >= config.jobMaxAttempts;
  await withTransaction(async (db) => {
    await query(
      db,
      `UPDATE jobs SET status = $2, run_at = $3, last_error = $4, lease_expires_at = NULL,
                       updated_at = $5
       WHERE id = $1 AND lease_holder = $6`,
      [
        job.id,
        dead ? 'dead' : 'queued',
        new Date(at.getTime() + backoff * 1000),
        String(error).slice(0, 500),
        at,
        job.lease_holder,
      ],
    );
  });
}

async function runThumbnail(job: ClaimedJob): Promise<unknown> {
  const photoId = String(job.payload.photo_id);
  const photo = await withClient((db) =>
    queryOne<{
      id: string;
      visit_id: string;
      hoof: string;
      phase: string;
      object_key: string;
      deleted_at: Date | null;
    }>(
      db,
      'SELECT id, visit_id, hoof, phase, object_key, deleted_at FROM photos WHERE id = $1',
      [photoId],
    ),
  );
  // A photo deleted before the object is written leaves nothing behind.
  if (photo === null || photo.deleted_at !== null) return { photo_id: photoId };

  const bytes = await getObject(photo.object_key);
  if (bytes === null) return { photo_id: photoId };
  const thumbnail = await makeThumbnail(bytes);
  const key = objectKeys.thumbnail(photo.visit_id, photo.hoof, photo.phase, photo.id);
  await putObject(key, thumbnail, 'image/jpeg');

  const stillThere = await withTransaction(async (db) => {
    const row = await queryOne<{ deleted_at: Date | null }>(
      db,
      'SELECT deleted_at FROM photos WHERE id = $1 FOR UPDATE',
      [photoId],
    );
    if (row === null || row.deleted_at !== null) return false;
    await query(db, `UPDATE photos SET thumbnail_status = 'ready', thumbnail_key = $2 WHERE id = $1`, [
      photoId,
      key,
    ]);
    return true;
  });
  // A photo deleted while this job ran takes its written object with it.
  if (!stillThere) await deleteObject(key);
  return { photo_id: photoId };
}

async function runDunningRetry(job: ClaimedJob): Promise<unknown> {
  const invoiceId = String(job.payload.invoice_id);
  await withTransaction(async (db) => {
    const at = now();
    const { timeZone } = await practice(db);
    const invoice = await loadInvoice(db, invoiceId, true);
    if (invoice === null || invoice.status !== 'unpaid') return;
    if (invoice.dunning_state === 'blocked' || invoice.dunning_state === 'cleared') return;

    const owner = await queryOne<{ email: string; name: string; card_token: string | null }>(
      db,
      'SELECT email, name, card_token FROM users WHERE id = $1',
      [invoice.owner_id],
    );
    if (owner === null || owner.card_token === null) return;

    const context = {
      actor: systemActor,
      requestId: null,
      at,
      timeZone,
      queueKind: 'background' as const,
      ownerEmail: owner.email,
    };
    const card = chargeCard(owner.card_token);
    const paymentId = newId();
    await query(
      db,
      `INSERT INTO payments (id, kind, status, owner_id, invoice_id, amount_cents,
                             card_token, card_last4, decline_code, created_at)
       VALUES ($1,'invoice',$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        paymentId,
        card.approved ? 'authorized' : 'declined',
        invoice.owner_id,
        invoice.id,
        invoice.balance_cents,
        owner.card_token,
        card.last4,
        card.declineCode,
        at,
      ],
    );
    if (!card.approved) {
      // A retry is what moves the soft steps along.
      await recordDecline(db, invoice, isHardDecline(card.declineCode), context, 'retry');
      return;
    }

    if (invoice.killbill_invoice_id === null) throw new KillBillUnavailable('invoice is not in billing');
    const accountId = await killbill.ensureAccount(owner.email, owner.name);
    await killbill.createExternalPayment(
      accountId,
      invoice.killbill_invoice_id,
      invoice.balance_cents,
      `${paymentId}:capture`,
    );
    await query(
      db,
      `UPDATE payments SET status = 'captured', captured_cents = $2, killbill_status = 'recorded',
                           killbill_invoice_id = $3
       WHERE id = $1`,
      [paymentId, invoice.balance_cents, invoice.killbill_invoice_id],
    );
    await query(db, `UPDATE invoices SET status = 'paid', balance_cents = 0 WHERE id = $1`, [invoice.id]);
    await writeAudit(db, {
      actor: systemActor,
      action: 'pay',
      entityType: 'invoice',
      entityId: invoice.id,
      from: invoice.status,
      to: 'paid',
      at,
      requestId: null,
    });
    await writeLedger(db, {
      kind: 'invoice_payment',
      amountCents: invoice.balance_cents,
      at,
      ownerId: invoice.owner_id,
      horseId: invoice.horse_id,
      businessDate: businessDateAt(at, timeZone),
      invoiceId: invoice.id,
      paymentId,
    });
    await clearDunning(db, invoice, context);
  });
  return null;
}

async function runDueReminder(job: ClaimedJob): Promise<unknown> {
  const horseId = String(job.payload.horse_id);
  const nextDueDate = String(job.payload.next_due_date);
  await withTransaction(async (db) => {
    const horse = await queryOne<{ name: string; owner_email: string }>(
      db,
      `SELECT h.name, u.email AS owner_email FROM horses h JOIN users u ON u.id = h.owner_id
       WHERE h.id = $1`,
      [horseId],
    );
    if (horse === null) return;
    const message = dueReminderEmail(horse.name, nextDueDate);
    await queueBackgroundEmail(db, {
      to: horse.owner_email,
      subject: message.subject,
      body: message.body,
      dedupeKey: `due_reminder:${horseId}:${nextDueDate}`,
    });
  });
  return { horse_id: horseId, next_due_date: nextDueDate };
}

async function runOfferPass(): Promise<unknown> {
  const dayIds = await withClient((db) =>
    query<{ id: string }>(
      db,
      `SELECT d.id FROM barn_days d WHERE d.status = 'published' AND d.starts_at > $1`,
      [now()],
    ),
  );
  for (const day of dayIds) {
    await prepareDay(day.id, { actor: systemActor, requestId: null, queueKind: 'background' });
  }
  return null;
}

/** A cell starting with =, +, - or @ gets a leading apostrophe; names only in this file. */
function neutralise(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const safe = neutralise(value);
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

async function runCsvExport(job: ClaimedJob): Promise<unknown> {
  const month = String(job.payload.month);
  const rows = await withClient(async (db) => {
    const { timeZone } = await practice(db);
    const entries = await query<{
      kind: string;
      amount_cents: number;
      at: Date;
      owner_name: string;
      horse_name: string;
    }>(
      db,
      `SELECT l.kind, l.amount_cents, l.at, u.name AS owner_name, h.name AS horse_name
       FROM ledger_entries l JOIN users u ON u.id = l.owner_id JOIN horses h ON h.id = l.horse_id
       ORDER BY l.at`,
    );
    return entries
      .filter((entry) => monthAt(entry.at, timeZone) === month)
      .map((entry) =>
        [
          businessDateAt(entry.at, timeZone),
          entry.kind,
          csvCell(entry.owner_name),
          csvCell(entry.horse_name),
          dollars(Math.abs(entry.amount_cents)),
        ].join(','),
      );
  });

  const csv = ['date,kind,owner,horse,amount', ...rows].join('\n');
  const key = objectKeys.export(month, job.id);
  await putObject(key, Buffer.from(`${csv}\n`, 'utf8'), 'text/csv; charset=utf-8');
  return await withClient(async (db) => {
    const { timeZone } = await practice(db);
    const signed = await signExportPath(db, job.id);
    return { key, url: signed.url, url_expires_at: formatInstant(signed.expiresAt, timeZone) };
  });
}

async function runJob(job: ClaimedJob): Promise<void> {
  try {
    let result: unknown = null;
    switch (job.kind) {
      case 'thumbnail':
        result = await runThumbnail(job);
        break;
      case 'dunning_retry':
        result = await runDunningRetry(job);
        break;
      case 'due_reminder':
        result = await runDueReminder(job);
        break;
      case 'offer_pass':
        result = await runOfferPass();
        break;
      case 'csv_export':
        result = await runCsvExport(job);
        break;
    }
    await succeed(job, result);
  } catch (error) {
    log.event({ event: 'job_failed', job_id: job.id, kind: job.kind });
    await fail(job, error);
  }
}

/** Each horse in due status gets one reminder job per next-due date, once across all instances. */
async function scanDueReminders(): Promise<void> {
  await withTransaction(async (db) => {
    const at = now();
    const { timeZone } = await practice(db);
    const today = businessDateAt(at, timeZone);
    const horses = await query<{ id: string; cycle_weeks: number; last: string | null }>(
      db,
      `SELECT h.id, h.cycle_weeks,
              (SELECT to_char(MAX(v.business_date),'YYYY-MM-DD') FROM visits v
               WHERE v.horse_id = h.id AND v.status <> 'open') AS last
       FROM horses h`,
    );
    for (const horse of horses) {
      const due = nextDue(horse.last, horse.cycle_weeks, today);
      if (due.dueStatus !== 'due' || due.nextDueDate === null) continue;
      const claimed = await query<{ horse_id: string }>(
        db,
        `INSERT INTO due_reminders_sent (horse_id, next_due_date) VALUES ($1,$2)
         ON CONFLICT DO NOTHING RETURNING horse_id`,
        [horse.id, due.nextDueDate],
      );
      if (claimed.length === 0) continue;
      await query(
        db,
        `INSERT INTO jobs (id, kind, status, payload, result, max_attempts, run_at, dedupe_key,
                           created_at, updated_at)
         VALUES ($1,'due_reminder','queued',$2::jsonb,$2::jsonb,$3,$4,$5,$4,$4)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [
          newId(),
          JSON.stringify({ horse_id: horse.id, next_due_date: due.nextDueDate }),
          config.jobMaxAttempts,
          at,
          `due_reminder:${horse.id}:${due.nextDueDate}`,
        ],
      );
    }
  });
}

/** Pending invoices are retried after the hold-off until every leg is in Kill Bill. */
async function reconcilePendingInvoices(): Promise<void> {
  const ids = await withClient((db) => pendingInvoiceIds(db, now()));
  for (const id of ids) {
    await finishInvoiceInKillBill(id, { queueKind: 'background', actor: systemActor, requestId: null });
  }
}

let timers: NodeJS.Timeout[] = [];
let running = false;
let activeJobs = 0;

function every(ms: number, work: () => Promise<void>): void {
  const timer = setInterval(() => {
    if (!running) return;
    void work().catch((error: unknown) => log.error('worker_failed', { detail: String(error) }));
  }, ms);
  timer.unref();
  timers.push(timer);
}

export function startWorkers(): void {
  running = true;
  every(500, async () => {
    const job = await withTransaction((db) => claimJob(db, now()));
    if (job === null) return;
    activeJobs += 1;
    try {
      await runJob(job);
    } finally {
      activeJobs -= 1;
    }
  });
  every(300, async () => {
    await pumpOutboxOnce();
  });
  every(5000, async () => {
    await reconcilePendingInvoices();
  });
  every(5000, async () => {
    await runOfferPass();
  });
  every(config.reminderScanSeconds * 1000, async () => {
    await scanDueReminders();
  });
  every(60000, async () => {
    await withTransaction((db) => pruneSigningKeys(db));
  });
}

export async function stopWorkers(): Promise<void> {
  running = false;
  for (const timer of timers) clearInterval(timer);
  timers = [];
  // A job already executing finishes and records its outcome.
  while (activeJobs > 0) await new Promise((resolve) => setTimeout(resolve, 25));
}

/** A job this instance claimed but has not started returns to queued with no attempt counted. */
export async function releaseClaims(db: Db): Promise<void> {
  await query(
    db,
    `UPDATE jobs SET status = 'queued', attempts = GREATEST(attempts - 1, 0),
                     lease_expires_at = NULL, lease_holder = NULL
     WHERE status = 'running' AND lease_holder = $1`,
    [LEASE_HOLDER],
  );
}

