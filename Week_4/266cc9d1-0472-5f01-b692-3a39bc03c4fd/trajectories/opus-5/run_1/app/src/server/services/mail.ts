/**
 * The shared email outbox. A request records its email and tries to send it
 * within five seconds; any process that can reach mail retries the rest.
 */

import { config } from "../config.js";
import { deliver, reachable, type SmtpTarget } from "./smtp.js";
import { pool, query, queryOne, type Tx } from "../db.js";
import { newId } from "../ids.js";

const ATTEMPT_LIMIT_MS = 5_000;
const RETRY_INTERVAL_MS = 15_000;

export type EmailState = "queued" | "sent";

export interface OutboxEmail {
  id: string;
  to_address: string;
  subject: string;
  body: string;
}

const target: SmtpTarget = {
  host: config.mail.host,
  port: config.mail.port,
  timeoutMs: ATTEMPT_LIMIT_MS,
};

export interface EmailDraft {
  kind: "review_link" | "decision_summary";
  reviewLinkId: string | null;
  to: string;
  subject: string;
  body: string;
}

/** Records the email inside the caller's transaction and claims it for five seconds. */
export async function recordEmail(tx: Tx, draft: EmailDraft): Promise<string> {
  const id = newId("eml");
  await tx.query(
    `INSERT INTO emails (id, kind, review_link_id, to_address, subject, body, state, claimed_until)
     VALUES ($1,$2,$3,$4,$5,$6,'queued', now() + interval '5 seconds')`,
    [id, draft.kind, draft.reviewLinkId, draft.to, draft.subject, draft.body],
  );
  return id;
}

async function send(email: OutboxEmail): Promise<void> {
  await deliver(target, {
    from: config.mail.from,
    to: email.to_address,
    subject: email.subject,
    body: email.body,
  });
}

/** Tries one email now. Returns whether the mail server accepted it. */
export async function attemptDelivery(emailId: string): Promise<EmailState> {
  const email = await queryOne<OutboxEmail & { state: EmailState }>(
    "SELECT id, to_address, subject, body, state FROM emails WHERE id = $1",
    [emailId],
  );
  if (!email) return "queued";
  if (email.state === "sent") return "sent";
  try {
    await send(email);
  } catch {
    return "queued";
  }
  await query(
    "UPDATE emails SET state = 'sent', sent_at = now() WHERE id = $1 AND state = 'queued'",
    [emailId],
  );
  return "sent";
}

/** The delivery state of the most recent email recorded for a review link. */
export async function linkEmailState(reviewLinkId: string): Promise<EmailState> {
  const row = await queryOne<{ state: EmailState }>(
    `SELECT state FROM emails WHERE review_link_id = $1
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [reviewLinkId],
  );
  return row?.state ?? "queued";
}

async function claimQueued(): Promise<OutboxEmail[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query<OutboxEmail>(
      `UPDATE emails SET claimed_until = now() + interval '20 seconds'
       WHERE id IN (
         SELECT id FROM emails
         WHERE state = 'queued' AND (claimed_until IS NULL OR claimed_until < now())
         ORDER BY created_at
         LIMIT 20
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, to_address, subject, body`,
    );
    await client.query("COMMIT");
    return claimed.rows;
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return [];
  } finally {
    client.release();
  }
}

let mailReachable = false;

export function isMailReachable(): boolean {
  return mailReachable;
}

export async function probeMail(): Promise<boolean> {
  mailReachable = await reachable(target);
  return mailReachable;
}

async function drainOutbox(): Promise<void> {
  for (const email of await claimQueued()) {
    try {
      await send(email);
      await query("UPDATE emails SET state = 'sent', sent_at = now() WHERE id = $1", [email.id]);
    } catch {
      await query("UPDATE emails SET claimed_until = NULL WHERE id = $1", [email.id]);
      return;
    }
  }
}

export function startOutboxWorker(): void {
  const tick = async (): Promise<void> => {
    await probeMail();
    if (mailReachable) await drainOutbox();
  };
  void tick();
  setInterval(() => void tick(), RETRY_INTERVAL_MS).unref();
}
