import { config } from '../config.js';
import { query, queryOne, type Db } from '../db.js';
import { newId } from '../util.js';
import { writeAudit, type Actor } from '../audit.js';
import { queueBackgroundEmail, queueRequestEmail } from '../services/mail.js';
import { dunningEmail, type DunningEmailState } from '../services/emails.js';
import { businessDateAt } from './time.js';
import type { DunningState, InvoiceRow } from './invoicing.js';

/**
 * Dunning. A declined payment stamps the retry instants once; each retry moves one
 * step, a hard decline goes straight to blocked, and any successful payment clears it.
 */
const SOFT_STEPS: Record<string, DunningState> = {
  none: 'past_due',
  past_due: 'retry_1',
  retry_1: 'retry_2',
  retry_2: 'blocked',
};

export interface DunningContext {
  actor: Actor;
  requestId: string | null;
  at: Date;
  timeZone: string;
  queueKind: 'request' | 'background';
  ownerEmail: string;
}

function retryInstants(firstDeclinedAt: Date): Date[] {
  return config.dunningRetryDays.map(
    (days) => new Date(firstDeclinedAt.getTime() + days * config.dunningDaySeconds * 1000),
  );
}

/** The business date of the invoice's next retry, or of its last one when none remain. */
export function nextTryDate(
  firstDeclinedAt: Date,
  state: DunningState,
  timeZone: string,
): string {
  const instants = retryInstants(firstDeclinedAt);
  const index =
    state === 'none' || state === 'past_due' ? 0 : state === 'retry_1' ? 1 : 2;
  const chosen = instants[Math.min(index, instants.length - 1)] ?? firstDeclinedAt;
  return businessDateAt(chosen, timeZone);
}

async function sendDunningEmail(
  db: Db,
  invoice: InvoiceRow,
  state: DunningEmailState,
  context: DunningContext,
  firstDeclinedAt: Date | null,
): Promise<void> {
  const nextTry =
    firstDeclinedAt === null ? null : nextTryDate(firstDeclinedAt, state === 'cleared' ? 'none' : state, context.timeZone);
  const message = dunningEmail(state, invoice.horse_name, invoice.business_date, nextTry);
  const email = {
    to: context.ownerEmail,
    subject: message.subject,
    body: message.body,
    dedupeKey: `dunning:${invoice.id}:${state}`,
  };
  if (context.queueKind === 'request') await queueRequestEmail(db, email);
  else await queueBackgroundEmail(db, email);
}

async function scheduleRetries(db: Db, invoice: InvoiceRow, firstDeclinedAt: Date): Promise<void> {
  const instants = retryInstants(firstDeclinedAt);
  for (let index = 0; index < instants.length; index += 1) {
    await query(
      db,
      `INSERT INTO jobs (id, kind, status, payload, max_attempts, run_at, dedupe_key, created_at, updated_at)
       VALUES ($1,'dunning_retry','queued',$2::jsonb,$3,$4,$5,$6,$6)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [
        newId(),
        JSON.stringify({ invoice_id: invoice.id, step: index + 1 }),
        config.jobMaxAttempts,
        instants[index],
        `dunning_retry:${invoice.id}:${index + 1}`,
        firstDeclinedAt,
      ],
    );
  }
}

async function cancelRetries(db: Db, invoiceId: string): Promise<void> {
  await query(
    db,
    `DELETE FROM jobs WHERE kind = 'dunning_retry' AND status = 'queued'
       AND payload->>'invoice_id' = $1`,
    [invoiceId],
  );
}

async function moveTo(
  db: Db,
  invoice: InvoiceRow,
  state: DunningState,
  context: DunningContext,
): Promise<void> {
  await query(db, 'UPDATE invoices SET dunning_state = $2 WHERE id = $1', [invoice.id, state]);
  await writeAudit(db, {
    actor: context.actor,
    action: 'dunning',
    entityType: 'dunning',
    entityId: invoice.id,
    from: invoice.dunning_state,
    to: state,
    at: context.at,
    requestId: context.requestId,
  });
}

/**
 * Records a declined payment against an invoice and moves its dunning state. The soft
 * steps belong to the scheduled retries: a later manual decline changes nothing unless
 * it is hard, which goes straight to blocked.
 */
export async function recordDecline(
  db: Db,
  invoice: InvoiceRow,
  hardDecline: boolean,
  context: DunningContext,
  source: 'manual' | 'retry' = 'manual',
): Promise<DunningState> {
  if (invoice.dunning_state === 'blocked') return 'blocked';

  let firstDeclinedAt = invoice.first_declined_at;
  if (firstDeclinedAt === null) {
    firstDeclinedAt = context.at;
    await query(db, 'UPDATE invoices SET first_declined_at = $2 WHERE id = $1', [
      invoice.id,
      firstDeclinedAt,
    ]);
    await scheduleRetries(db, invoice, firstDeclinedAt);
  }

  if (hardDecline) {
    await moveTo(db, invoice, 'blocked', context);
    await cancelRetries(db, invoice.id);
    await sendDunningEmail(db, invoice, 'blocked', context, firstDeclinedAt);
    return 'blocked';
  }

  if (source === 'manual' && invoice.dunning_state !== 'none') return invoice.dunning_state;

  const next = SOFT_STEPS[invoice.dunning_state];
  if (next === undefined) return invoice.dunning_state;
  await moveTo(db, invoice, next, context);
  if (next === 'blocked') await cancelRetries(db, invoice.id);
  await sendDunningEmail(db, invoice, next as DunningEmailState, context, firstDeclinedAt);
  return next;
}

/** Any successful payment clears dunning. */
export async function clearDunning(
  db: Db,
  invoice: InvoiceRow,
  context: DunningContext,
): Promise<void> {
  if (invoice.dunning_state === 'none') return;
  await moveTo(db, invoice, 'cleared', context);
  await cancelRetries(db, invoice.id);
  await sendDunningEmail(db, invoice, 'cleared', context, invoice.first_declined_at);
}

export async function ownerHasBlockedInvoice(db: Db, ownerId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM invoices WHERE owner_id = $1 AND dunning_state = 'blocked' AND status <> 'paid' LIMIT 1`,
    [ownerId],
  );
  return row !== null;
}
