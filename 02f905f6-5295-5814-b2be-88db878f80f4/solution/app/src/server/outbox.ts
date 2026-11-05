// The mail outbox (ready notices, reminders, new links) and the pickup clock sweeper.
import type pg from "pg";
import { daysOnShelf, LAPSE_DAYS, REMINDER_DAYS, shelfThreshold } from "./clock";
import { pool, tx } from "./db";
import { pickupReminder, send, type Message } from "./mail";
import { addHistory, pieceNumberText, SYSTEM_ACTOR } from "./pieces";

/** Queues a message in the same transaction as the change that causes it. */
export async function enqueue(client: pg.PoolClient, message: Message): Promise<void> {
  await client.query(
    `INSERT INTO outbox (to_address, to_name, subject, text_body, html_body, created_at) VALUES ($1, $2, $3, $4, $5, now())`,
    [message.toAddress, message.toName, message.subject, message.text, message.html],
  );
}

interface OutboxRow {
  id: string;
  to_address: string;
  to_name: string;
  subject: string;
  text_body: string;
  html_body: string;
}

const CLAIM_SECONDS = 60;
let draining = false;

/** Sends every pending message once; a claim keeps other instances off a message while it is sent. */
export async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const claimed = await pool.query<OutboxRow>(
        `UPDATE outbox SET claimed_until = now() + make_interval(secs => $1)
         WHERE id = (SELECT id FROM outbox WHERE sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < now())
                     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING *`,
        [CLAIM_SECONDS],
      );
      const row = claimed.rows[0];
      if (!row) return;
      try {
        await send({ toAddress: row.to_address, toName: row.to_name, subject: row.subject, text: row.text_body, html: row.html_body });
      } catch {
        await pool.query("UPDATE outbox SET claimed_until = NULL WHERE id = $1", [row.id]);
        return;
      }
      await pool.query("UPDATE outbox SET sent_at = now() WHERE id = $1", [row.id]);
    }
  } finally {
    draining = false;
  }
}

interface DuePiece {
  number: number;
  pickup_shelf: string;
  ready_at: Date;
  to_address: string;
  to_name: string;
}

const OWNER_CONTACT = `SELECT p.number, p.pickup_shelf, p.ready_at,
    COALESCE(u.email, p.guest_email) AS to_address, COALESCE(u.name, p.guest_name) AS to_name
  FROM pieces p LEFT JOIN users u ON u.id = p.member_id`;

/** One reminder at 14 studio days, and the lapse to Uncollected at 21, each exactly once. */
async function sweepPickupShelf(): Promise<void> {
  const now = new Date();
  await tx(async (client) => {
    const due = await client.query<DuePiece>(
      `${OWNER_CONTACT} WHERE p.status = 'ready' AND NOT p.reminder_sent AND p.ready_at <= $1 FOR UPDATE OF p SKIP LOCKED`,
      [shelfThreshold(now, REMINDER_DAYS)],
    );
    for (const piece of due.rows) {
      await client.query("UPDATE pieces SET reminder_sent = true WHERE number = $1", [piece.number]);
      await enqueue(
        client,
        pickupReminder(piece.to_address, piece.to_name, pieceNumberText(piece.number), piece.pickup_shelf, daysOnShelf(piece.ready_at, now)),
      );
    }
  });
  await tx(async (client) => {
    const lapsed = await client.query<{ number: number }>(
      `UPDATE pieces SET status = 'uncollected' WHERE status = 'ready' AND reminder_sent AND ready_at <= $1 RETURNING number`,
      [shelfThreshold(now, LAPSE_DAYS)],
    );
    for (const piece of lapsed.rows) await addHistory(client, piece.number, SYSTEM_ACTOR, "uncollected", now);
  });
}

export function startBackgroundWork(): void {
  const sweep = () => sweepPickupShelf().then(drainOutbox).catch((error: Error) => console.error("sweep failed:", error.message));
  setInterval(sweep, 4000);
  setInterval(() => drainOutbox().catch((error: Error) => console.error("outbox failed:", error.message)), 10_000);
  sweep();
}
