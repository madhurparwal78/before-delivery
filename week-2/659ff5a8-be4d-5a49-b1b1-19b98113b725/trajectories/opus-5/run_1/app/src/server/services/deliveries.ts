import { randomUUID } from 'node:crypto';
import { query } from '../db/pool';
import { MailUnavailable, sendMail } from './smtp';

export type DeliveryKind = 'registration_confirmation' | 'work_assignment' | 'final_results';
export type FailingService = 'renderer' | 'storage' | 'mail';

const RETRY_INTERVAL_MS = 15_000;

export interface DeliveryRow {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  state: string;
}

export async function recordDeliveryFailure(
  clubId: string,
  service: FailingService,
  eventId: string | null,
): Promise<void> {
  await query(
    'INSERT INTO delivery_failures (id, club_id, event_id, service) VALUES ($1, $2, $3, $4)',
    [randomUUID(), clubId, eventId, service],
  );
}

export async function enqueueDelivery(input: {
  clubId: string;
  eventId: string | null;
  registrationId: string | null;
  kind: DeliveryKind;
  dedupeKey: string;
  recipient: string;
  subject: string;
  body: string;
}): Promise<string | null> {
  const id = randomUUID();
  const rows = await query<{ id: string }>(
    `INSERT INTO email_deliveries
       (id, club_id, event_id, registration_id, kind, dedupe_key, recipient, subject, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      id,
      input.clubId,
      input.eventId,
      input.registrationId,
      input.kind,
      input.dedupeKey,
      input.recipient,
      input.subject,
      input.body,
    ],
  );
  return rows[0]?.id ?? null;
}

async function markSent(id: string): Promise<void> {
  await query(
    `UPDATE email_deliveries
        SET state = 'sent', sent_at = now(), attempts = attempts + 1, last_attempt_at = now()
      WHERE id = $1`,
    [id],
  );
}

async function markAttempted(id: string): Promise<void> {
  await query(
    'UPDATE email_deliveries SET attempts = attempts + 1, last_attempt_at = now() WHERE id = $1',
    [id],
  );
}

/** Tries one queued delivery. Returns true when the mail server accepted it. */
export async function attemptDelivery(id: string): Promise<boolean> {
  const rows = await query<DeliveryRow & { club_id: string; event_id: string | null }>(
    `SELECT id, recipient, subject, body, state, club_id, event_id
       FROM email_deliveries WHERE id = $1 AND state = 'pending'`,
    [id],
  );
  const delivery = rows[0];
  if (!delivery) return true;
  try {
    await sendMail({ to: delivery.recipient, subject: delivery.subject, body: delivery.body });
    await markSent(delivery.id);
    return true;
  } catch (error) {
    await markAttempted(delivery.id);
    await recordDeliveryFailure(delivery.club_id, 'mail', delivery.event_id);
    if (error instanceof MailUnavailable) return false;
    throw error;
  }
}

export function startDeliveryRetryLoop(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void (async () => {
      const pending = await query<{ id: string }>(
        `SELECT id FROM email_deliveries
          WHERE state = 'pending' AND kind <> 'final_results'
          ORDER BY created_at LIMIT 25`,
      );
      for (const row of pending) {
        const accepted = await attemptDelivery(row.id);
        if (!accepted) break;
      }
    })().catch((error: unknown) => {
      process.stderr.write(`delivery retry failed: ${String(error)}\n`);
    });
  }, RETRY_INTERVAL_MS);
  timer.unref();
  return timer;
}
