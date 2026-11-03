// Time-driven changes: offer expiry, completion after the scheduled end, credential warnings.
import type { PoolClient } from "pg";
import { agencyDate } from "../shared/time.js";
import { audit } from "./audit.js";
import { ensureAllAccounts } from "./billing.js";
import { pool, transaction } from "./db.js";
import { LAPSED_OFFER_SQL, warningPeriodEnd } from "./domain/rules.js";
import { credentialWarningMail } from "./emails.js";
import { enqueue, kickOutbox } from "./outbox.js";
import { storePendingSeedFiles } from "./seed.js";

const SWEEP_MS = 20_000;

/** Persists expiry and completion that time has brought; rows another transaction holds are left for the next pass. */
export async function observe(): Promise<void> {
  await transaction(async (client) => {
    await recordExpiredOffers(client, null);
    const ended = await client.query<{ id: string }>(
      "SELECT id FROM requests WHERE status = 'staffed' AND end_at <= now() FOR UPDATE SKIP LOCKED",
    );
    for (const request of ended.rows) await persistCompletion(client, request.id);
  });
}

/** Marks lapsed offers expired, on one seat or (`null`) everywhere, each with its null-actor audit entry. */
export async function recordExpiredOffers(db: PoolClient, seatId: string | null): Promise<void> {
  const expired = await db.query<{ id: string; seat_id: string; request_id: string; interpreter_id: string }>(
    `UPDATE offers o SET status = 'expired' FROM seats s
     WHERE s.id = o.seat_id AND o.id IN (
       SELECT o.id FROM offers o WHERE ${LAPSED_OFFER_SQL} AND ($1::uuid IS NULL OR o.seat_id = $1) FOR UPDATE SKIP LOCKED)
     RETURNING o.id, o.seat_id, s.request_id, o.interpreter_id`,
    [seatId],
  );
  for (const offer of expired.rows) {
    await audit(db, {
      actorId: null,
      action: "offer.expired",
      entity: "offer",
      entityId: offer.id,
      requestId: offer.request_id,
      from: "active",
      to: "expired",
      detail: { seat_id: offer.seat_id, interpreter_id: offer.interpreter_id },
    });
  }
}

/** Persists staffed → completed for a request whose scheduled end has passed; the caller holds its row lock. */
export async function persistCompletion(db: PoolClient, requestId: string): Promise<void> {
  await db.query("UPDATE requests SET status = 'completed' WHERE id = $1", [requestId]);
  await audit(db, {
    actorId: null,
    action: "request.status_changed",
    entity: "request",
    entityId: requestId,
    requestId,
    from: "staffed",
    to: "completed",
  });
}

/** Queues exactly one warning per credential once its expiry is within the warning period and not yet past. */
export async function warnCredentials(): Promise<void> {
  const today = agencyDate(new Date());
  const queued = await transaction(async (client) => {
    const due = await client.query<{ type: string; number: string; expires_on: string; email: string }>(
      `UPDATE credentials c SET warned_at = now() FROM users u
       WHERE u.id = c.interpreter_id AND c.warned_at IS NULL AND c.expires_on >= $1::date AND c.expires_on <= $2::date
       RETURNING c.type, c.number, c.expires_on, u.email`,
      [today, warningPeriodEnd(today)],
    );
    for (const c of due.rows) await enqueue(client, credentialWarningMail(c.email, c.type, c.number, c.expires_on));
    return due.rowCount ?? 0;
  });
  if (queued) kickOutbox();
}

async function housekeeping(): Promise<void> {
  await pool.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '48 hours'");
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
}

async function pass(): Promise<void> {
  for (const job of [observe, warnCredentials, ensureAllAccounts, storePendingSeedFiles, housekeeping]) {
    try {
      await job();
    } catch (error) {
      console.error(`sweep ${job.name}:`, error instanceof Error ? error.message : error);
    }
  }
}

export function startSweeps(): void {
  void pass();
  setInterval(() => void pass(), SWEEP_MS).unref();
}
