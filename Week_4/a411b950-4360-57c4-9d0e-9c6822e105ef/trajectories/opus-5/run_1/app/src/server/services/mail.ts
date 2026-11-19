import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { query, withTransaction, type Queryable } from '../db/pool.ts';
import type { RenderedMessage } from './mime.ts';
import { deliverMessage } from './smtp.ts';

export const MAIL_KINDS = ['receipt', 'alert', 'proposal', 'month_held', 'deposit'] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export type MailState = 'pending' | 'sent' | 'cancelled';

export type QueuedEmail = {
  kind: MailKind;
  reference: string;
  to: string;
  queued_at: string;
  retry_at: string | null;
};

const KIND_ORDER_SQL = `array_position(ARRAY['receipt','alert','proposal','month_held','deposit']::text[], m.kind)`;

/** The one place that decides whether a pending proposal email is already cancelled. */
const CANCELLED_SQL = `(m.kind = 'proposal' AND (e.status = 'declined' OR (pr.expires_at IS NOT NULL AND pr.expires_at <= now())))`;

export async function queueEmail(
  client: Queryable,
  input: { kind: MailKind; enquiryId: string; reference: string; message: RenderedMessage },
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO mail_queue (id, kind, enquiry_id, reference, to_address, message, hold_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (kind, enquiry_id) DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      input.kind,
      input.enquiryId,
      input.reference,
      input.message.to,
      input.message.bytes,
      config.mail.retrySeconds,
    ],
  );
  return result.rows[0]?.id ?? null;
}

type AttemptOutcome = 'sent' | 'cancelled' | 'failed' | 'skipped';

async function attemptDelivery(id: string): Promise<AttemptOutcome> {
  return withTransaction(async (client) => {
    const locked = await client.query<{
      kind: MailKind;
      to_address: string;
      message: Buffer;
      hold_seconds: number;
      first_failed_at: Date | null;
      cancelled: boolean;
    }>(
      `SELECT m.kind, m.to_address, m.message, m.hold_seconds, m.first_failed_at,
              ${CANCELLED_SQL} AS cancelled
         FROM mail_queue m
         JOIN enquiries e ON e.id = m.enquiry_id
         LEFT JOIN proposals pr ON pr.enquiry_id = m.enquiry_id
        WHERE m.id = $1 AND m.state = 'pending'
          FOR UPDATE OF m SKIP LOCKED`,
      [id],
    );
    const row = locked.rows[0];
    if (row === undefined) return 'skipped';

    if (row.cancelled) {
      await client.query(`UPDATE mail_queue SET state = 'cancelled', cancelled_at = now() WHERE id = $1`, [id]);
      return 'cancelled';
    }

    try {
      await deliverMessage(row.to_address, row.message);
    } catch {
      if (row.first_failed_at === null) {
        await client.query(
          `UPDATE mail_queue
              SET first_failed_at = now(), retry_at = now() + make_interval(secs => $2::double precision)
            WHERE id = $1`,
          [id, row.hold_seconds],
        );
      }
      return 'failed';
    }
    await client.query(`UPDATE mail_queue SET state = 'sent', sent_at = now() WHERE id = $1`, [id]);
    return 'sent';
  });
}

/** The queueing instance's own first attempt. Reports what the response should say. */
export async function deliverQueued(id: string | null): Promise<MailState> {
  if (id === null) return 'pending';
  const outcome = await attemptDelivery(id);
  if (outcome === 'sent') return 'sent';
  if (outcome === 'cancelled') return 'cancelled';
  return 'pending';
}

export async function cancelPendingProposalEmail(client: Queryable, enquiryId: string): Promise<void> {
  await client.query(
    `UPDATE mail_queue SET state = 'cancelled', cancelled_at = now()
      WHERE enquiry_id = $1 AND kind = 'proposal' AND state = 'pending'`,
    [enquiryId],
  );
}

export async function readMailStates(
  client: Queryable,
  enquiryIds: readonly string[],
): Promise<Map<string, Partial<Record<MailKind, MailState>>>> {
  const states = new Map<string, Partial<Record<MailKind, MailState>>>();
  if (enquiryIds.length === 0) return states;
  const result = await client.query<{ enquiry_id: string; kind: MailKind; state: MailState; cancelled: boolean }>(
    `SELECT m.enquiry_id, m.kind, m.state, ${CANCELLED_SQL} AS cancelled
       FROM mail_queue m
       JOIN enquiries e ON e.id = m.enquiry_id
       LEFT JOIN proposals pr ON pr.enquiry_id = m.enquiry_id
      WHERE m.enquiry_id = ANY($1::uuid[])`,
    [[...enquiryIds]],
  );
  for (const row of result.rows) {
    const existing = states.get(row.enquiry_id) ?? {};
    existing[row.kind] = row.state === 'pending' && row.cancelled ? 'cancelled' : row.state;
    states.set(row.enquiry_id, existing);
  }
  return states;
}

export async function pendingEmails(): Promise<QueuedEmail[]> {
  const result = await query<{
    kind: MailKind;
    reference: string;
    to_address: string;
    queued_at: Date;
    retry_at: Date | null;
  }>(
    `SELECT m.kind, m.reference, m.to_address, m.queued_at, m.retry_at
       FROM mail_queue m
       JOIN enquiries e ON e.id = m.enquiry_id
       LEFT JOIN proposals pr ON pr.enquiry_id = m.enquiry_id
      WHERE m.state = 'pending' AND NOT ${CANCELLED_SQL}
      ORDER BY m.queued_at ASC, m.reference ASC, ${KIND_ORDER_SQL} ASC`,
  );
  return result.rows.map((row) => ({
    kind: row.kind,
    reference: row.reference,
    to: row.to_address,
    queued_at: row.queued_at.toISOString(),
    retry_at: row.retry_at === null ? null : row.retry_at.toISOString(),
  }));
}

async function sweep(): Promise<void> {
  const due = await query<{ id: string }>(
    `SELECT id FROM mail_queue
      WHERE state = 'pending' AND (retry_at IS NULL OR retry_at <= now())
      ORDER BY queued_at ASC
      LIMIT 50`,
  );
  for (const row of due.rows) {
    await attemptDelivery(row.id);
  }
}

export function startMailWorker(): void {
  const interval = setInterval(() => {
    void sweep().catch(() => {
      /* an unreachable database or mail server is retried on the next sweep */
    });
  }, config.mail.retrySeconds * 1000);
  interval.unref();
}
