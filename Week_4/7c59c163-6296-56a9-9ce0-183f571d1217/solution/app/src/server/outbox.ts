import type { Db } from "./db.js";
import { pool, rows } from "./db.js";
import { ProviderDown } from "./errors.js";
import { sendMail, type Email } from "./mail.js";
import { sendMessage, type WebhookMessage } from "./svix.js";

// Emails and webhook messages are written here in the same transaction as the change that causes
// them. Every instance drains the queue; rows are claimed without blocking one another. An instance
// that cannot reach a provider hands its rows straight back and stops claiming that kind for the
// backoff, so an instance whose provider is up delivers them instead of waiting out the backoff.

type Item = { kind: "email"; payload: Email } | { kind: "webhook"; payload: WebhookMessage };

async function enqueue(db: Db, venueId: string | null, item: Item): Promise<void> {
  await db.query("INSERT INTO outbox (venue_id, kind, payload) VALUES ($1, $2, $3)", [venueId, item.kind, JSON.stringify(item.payload)]);
}

export const enqueueEmail = (db: Db, venueId: string | null, email: Email) => enqueue(db, venueId, { kind: "email", payload: email });
export const enqueueWebhook = (db: Db, venueId: string, message: WebhookMessage) => enqueue(db, venueId, { kind: "webhook", payload: message });

/** Emails retry every 10 s; webhook messages back off 5 → 60 s, doubling. */
function retryDelaySeconds(kind: Item["kind"], attempts: number): number {
  return kind === "email" ? 10 : Math.min(60, 5 * 2 ** Math.max(0, attempts - 1));
}

interface ClaimedRow {
  id: number;
  kind: Item["kind"];
  payload: Email & WebhookMessage;
  attempts: number;
}

let draining = false;
const pausedUntil: Partial<Record<Item["kind"], number>> = {};

export async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const paused = (Object.keys(pausedUntil) as Item["kind"][]).filter((kind) => (pausedUntil[kind] ?? 0) > Date.now());
    const claimed = await rows<ClaimedRow>(
      pool,
      `UPDATE outbox SET locked_until = now() + interval '30 seconds', attempts = attempts + 1
        WHERE id IN (SELECT id FROM outbox
                      WHERE done_at IS NULL AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
                        AND kind <> ALL($1::text[])
                      ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
        RETURNING id, kind, payload, attempts`,
      [paused],
    );
    await Promise.all(
      claimed.map(async (row) => {
        try {
          if (row.kind === "email") await sendMail(row.payload);
          else await sendMessage(row.payload);
          await pool.query("UPDATE outbox SET done_at = now(), locked_until = NULL WHERE id = $1", [row.id]);
        } catch (error) {
          const delay = retryDelaySeconds(row.kind, row.attempts);
          if (error instanceof ProviderDown) {
            pausedUntil[row.kind] = Date.now() + delay * 1000;
            await pool.query("UPDATE outbox SET locked_until = NULL WHERE id = $1", [row.id]);
          } else {
            await pool.query("UPDATE outbox SET locked_until = NULL, next_attempt_at = now() + make_interval(secs => $2) WHERE id = $1", [row.id, delay]);
          }
          console.error(`outbox ${row.kind} ${row.id} retry in ${delay}s:`, error instanceof Error ? error.message : error);
        }
      }),
    );
  } finally {
    draining = false;
  }
}
