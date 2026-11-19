import { randomUUID } from "node:crypto";
import { one, pool, rows, tx, type Tx } from "./db.js";
import { sendMail } from "./mail.js";
import { fromStates, MOVES } from "./order-states.js";

// Every email is written here in the same transaction as the event that causes it. The writing
// instance tries it at once; a failed send waits RETRY_SECONDS; a claim excludes every other instance,
// and a message is marked sent only after the SMTP server accepted it.

const RETRY_SECONDS = 15;
const CLAIM_SECONDS = 120;

interface OutgoingEmail {
  kind: "receipt" | "render_ready" | "refund_notice" | "statement";
  to: string;
  subject: string;
  text: string;
  attachment?: { name: string; data: Buffer };
  orderId?: string;
}

interface OutboxRow {
  id: string;
  kind: OutgoingEmail["kind"];
  to_address: string;
  subject: string;
  text_body: string;
  attachment_name: string | null;
  attachment: Buffer | null;
  order_id: string | null;
}

/** Writes the message; the returned callback, run after commit, makes this instance's immediate attempt. */
export async function queueEmail(client: Tx, email: OutgoingEmail): Promise<() => void> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO outbox (id, kind, to_address, subject, text_body, attachment_name, attachment, order_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, email.kind, email.to, email.subject, email.text, email.attachment?.name ?? null, email.attachment?.data ?? null, email.orderId ?? null],
  );
  return () => void deliver(id);
}

const CLAIM = `UPDATE outbox SET claimed_until = now() + make_interval(secs => ${CLAIM_SECONDS})`;

async function deliver(id: string): Promise<void> {
  const claimed = await one<OutboxRow>(
    pool,
    `${CLAIM} WHERE id = $1 AND sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < now()) RETURNING *`,
    [id],
  );
  if (claimed) await send(claimed);
}

async function send(message: OutboxRow): Promise<void> {
  try {
    await sendMail({
      to: message.to_address,
      subject: message.subject,
      text: message.text_body,
      attachment: message.attachment_name && message.attachment ? { name: message.attachment_name, data: message.attachment } : null,
    });
  } catch (error) {
    await pool.query(
      `UPDATE outbox SET attempts = attempts + 1, claimed_until = NULL, last_error = $2,
              next_attempt_at = now() + make_interval(secs => ${RETRY_SECONDS}) WHERE id = $1`,
      [message.id, error instanceof Error ? error.message.slice(0, 300) : String(error)],
    );
    return;
  }
  await tx(async (client) => {
    await client.query("UPDATE outbox SET sent_at = now(), attempts = attempts + 1, claimed_until = NULL WHERE id = $1", [message.id]);
    if (message.kind === "receipt" && message.order_id) {
      await client.query(
        "UPDATE orders SET state = $2, receipt_status = 'sent' WHERE id = $1 AND state = ANY($3)",
        [message.order_id, MOVES.receipt.to, fromStates("receipt")],
      );
    }
  });
}

/** Claims and sends every due message; the caller only scans while its latest mail probe reached mail. */
export async function sendDue(): Promise<void> {
  const due = await rows<OutboxRow>(
    pool,
    `${CLAIM} WHERE id IN (
       SELECT id FROM outbox
        WHERE sent_at IS NULL AND next_attempt_at <= now() AND (claimed_until IS NULL OR claimed_until < now())
        ORDER BY next_attempt_at LIMIT 50 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
  );
  for (const message of due) await send(message);
}
