// Every email goes into a Postgres outbox first; a leased worker delivers each message exactly once.
import type { PoolClient } from "pg";
import { pool, rows } from "./db.js";
import { deliver } from "./mail.js";

const POLL_MS = 2000;
const LEASE_SECONDS = 30;
const RETRY_SECONDS = 5;

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

/** Queues a message inside the caller's transaction and returns its outbox id. */
export async function enqueue(client: PoolClient, mail: Mail): Promise<string> {
  const result = await client.query<{ id: string }>(
    "INSERT INTO outbox (to_email, subject, body) VALUES ($1, $2, $3) RETURNING id",
    [mail.to, mail.subject, mail.body],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("outbox insert returned no id");
  return id;
}

interface Claimed {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

let running = false;
let again = false;
// After a failed attempt this worker stops claiming for a while, so another instance whose mail
// server answers takes the messages instead of losing every claim race to this one.
let pausedUntil = 0;

async function drain(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  if (Date.now() < pausedUntil) return;
  running = true;
  try {
    do {
      again = false;
      const claimed = await rows<Claimed>(
        pool,
        `UPDATE outbox SET lease_until = now() + make_interval(secs => $1), attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM outbox
           WHERE sent_at IS NULL AND (lease_until IS NULL OR lease_until < now())
           ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
         RETURNING id, to_email, subject, body`,
        [LEASE_SECONDS],
      );
      for (const [i, mail] of claimed.entries()) {
        try {
          await deliver({ messageId: `<outbox-${mail.id}@fernhollow.test>`, to: mail.to_email, subject: mail.subject, body: mail.body });
          await pool.query("UPDATE outbox SET sent_at = now(), lease_until = NULL WHERE id = $1", [mail.id]);
        } catch {
          // Hand this message and the rest of the batch back at once, then step aside.
          await pool.query("UPDATE outbox SET lease_until = NULL WHERE id = ANY($1)", [claimed.slice(i).map((m) => m.id)]);
          pausedUntil = Date.now() + RETRY_SECONDS * 1000;
          return;
        }
      }
      if (claimed.length === 20) again = true;
    } while (again);
  } catch (error) {
    console.error("outbox:", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

/** Asks the worker to try delivery now; call after the transaction that queued mail commits. */
export function kickOutbox(): void {
  void drain();
}

export function startOutbox(): void {
  setInterval(kickOutbox, POLL_MS).unref();
  kickOutbox();
}
