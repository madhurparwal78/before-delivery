/** The transactional outbox relay: the only path from the app to the broker. */

import { OUTBOX_LOCK, withAdvisoryLock } from "../db/locks.js";
import { config } from "../config.js";
import { pool, withTransaction } from "../db/pool.js";
import {
  PARSE_EXCHANGE,
  publishConfirmed,
  WEBHOOK_EXCHANGE,
} from "../services/broker.js";

type OutboxRow = {
  id: string;
  kind: "pass.parse" | "webhook.send";
  pass_id: string | null;
  event_id: string | null;
  sha256: string | null;
};

let running = false;

async function relayOutbox(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    await withAdvisoryLock(OUTBOX_LOCK, OUTBOX_LOCK, async () => {
      const pending = await pool.query<OutboxRow>(
        `select o.id, o.kind, o.pass_id, o.event_id, p.sha256
         from outbox o left join passes p on p.id = o.pass_id
         where o.sent_at is null order by o.created_at limit 200`,
      );
      for (const row of pending.rows) {
        await withTransaction(async (tx) => {
          const claimed = await tx.query(
            "select id from outbox where id = $1 and sent_at is null for update skip locked",
            [row.id],
          );
          if (claimed.rowCount !== 1) return;
        if (row.kind === "pass.parse") {
          if (!row.pass_id) {
            return;
          }
          await publishConfirmed({
            exchange: PARSE_EXCHANGE,
            routingKey: "parse",
            type: "pass.parse",
            messageId: row.id,
            body: { pass_id: row.pass_id, sha256: row.sha256 ?? "" },
          });
        } else {
          if (!row.event_id) {
            return;
          }
          await publishConfirmed({
            exchange: WEBHOOK_EXCHANGE,
            routingKey: "send",
            type: "webhook.send",
            messageId: row.id,
            body: { event_id: row.event_id },
          });
        }
        await tx.query("update outbox set sent_at = now() where id = $1", [row.id]);
        });
      }
    });
  } catch {
    /* the broker is unreachable; the next run relays the backlog */
  } finally {
    running = false;
  }
}

export function kickRelay(): void {
  void relayOutbox();
}

/** Clears `sent_at`, so the relay publishes the row again as a new message. */
export async function resetOutboxRow(
  match: { passId?: string; eventId?: string },
): Promise<void> {
  if (match.passId) {
    await pool.query(
      "update outbox set sent_at = null where kind = 'pass.parse' and pass_id = $1",
      [match.passId],
    );
  }
  if (match.eventId) {
    await pool.query(
      "update outbox set sent_at = null where kind = 'webhook.send' and event_id = $1 and delivered_at is null",
      [match.eventId],
    );
  }
}

export function startOutboxRelay(): void {
  setInterval(() => kickRelay(), config.dependencyRetrySeconds * 1000).unref();
  kickRelay();
}
