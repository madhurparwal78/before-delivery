import type pg from "pg";
import { instanceId } from "./config.ts";
import { one, query, transaction } from "./db.ts";
import { probeMail, sendMail } from "./smtp.ts";

type OutgoingMail = { key: string; kind: string; to: string; subject: string; text: string };

const RETRY_DELAYS_S = [5, 15, 45] as const;
const RETRY_EVERY_S = 60;
const ATTEMPT_CEILING = 20;
const PROBE_EVERY_MS = 5_000;
const TICK_MS = 200;

/** The retry schedule: the delay after the n-th failed attempt (n from 1). */
function retryDelaySeconds(failures: number): number {
  return RETRY_DELAYS_S[failures - 1] ?? RETRY_EVERY_S;
}

let mailUp = true;
export const isMailUp = (): boolean => mailUp;

/** Enqueues in the caller's transaction; a second enqueue with the same key is a no-op. */
export async function enqueue(tx: pg.PoolClient, mail: OutgoingMail): Promise<void> {
  await tx.query(
    "INSERT INTO outbox (key, kind, to_address, subject, body, instance) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (key) DO NOTHING",
    [mail.key, mail.kind, mail.to, mail.subject, mail.text, instanceId],
  );
}

/** `<n>` for a message key, counting from 1 per record. */
export async function nextMailNumber(tx: pg.PoolClient, scope: string): Promise<number> {
  const row = await one<{ n: number }>(
    "INSERT INTO mail_counters (scope, n) VALUES ($1, 1) ON CONFLICT (scope) DO UPDATE SET n = mail_counters.n + 1 RETURNING n",
    [scope], tx,
  );
  return row?.n ?? 1;
}

/** SMTP has the message, so only the bookkeeping is retried until it lands, never the send. */
async function markSent(seq: string, attemptId: string | undefined): Promise<void> {
  for (;;) {
    try {
      await transaction(async (tx) => {
        await tx.query("UPDATE outbox_attempts SET finished_at = clock_timestamp(), outcome = 'sent' WHERE id = $1", [attemptId]);
        await tx.query("UPDATE outbox SET state = 'sent' WHERE seq = $1", [seq]);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, TICK_MS));
    }
  }
}

type Head = { seq: string; key: string; to_address: string; subject: string; body: string; failures: number; due: boolean };

let running = false;
let wakeRequested = false;

/** Delivers this instance's head message, oldest first; nothing newer is tried until it is sent or dead. */
async function deliverHead(): Promise<boolean> {
  const head = await one<Head>(
    `SELECT seq, key, to_address, subject, body, failures, next_attempt_at <= clock_timestamp() AS due
       FROM outbox WHERE instance = $1 AND state = 'pending' ORDER BY enqueued_at, seq LIMIT 1`,
    [instanceId],
  );
  if (!head || !head.due) return false;
  const attempt = await one<{ id: string }>("INSERT INTO outbox_attempts (seq, started_at) VALUES ($1, clock_timestamp()) RETURNING id", [head.seq]);
  const sent = await sendMail({ key: head.key, to: head.to_address, subject: head.subject, text: head.body }).then(() => true, () => false);
  if (sent) {
    await markSent(head.seq, attempt?.id);
    mailUp = true;
    return true;
  }
  const failures = head.failures + 1;
  await query("UPDATE outbox_attempts SET finished_at = clock_timestamp(), outcome = 'failed' WHERE id = $1", [attempt?.id]);
  await query(
    `UPDATE outbox SET failures = $2::int, state = CASE WHEN $2::int >= $3::int THEN 'dead' ELSE 'pending' END,
       next_attempt_at = clock_timestamp() + make_interval(secs => $4::double precision) WHERE seq = $1`,
    [head.seq, failures, ATTEMPT_CEILING, retryDelaySeconds(failures)],
  );
  return failures >= ATTEMPT_CEILING;
}

async function drain(): Promise<void> {
  if (running) {
    wakeRequested = true;
    return;
  }
  running = true;
  try {
    do {
      wakeRequested = false;
      let more = true;
      while (more) more = await deliverHead();
    } while (wakeRequested);
  } catch {
    wakeRequested = false;
  } finally {
    running = false;
  }
}

/** Asks the worker to look at the head now (after a commit that enqueued mail). */
export function wakeOutbox(): void {
  void drain();
}

/** Waits up to `ms` for one message to be accepted by SMTP. */
export async function awaitSent(key: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const row = await one<{ state: string }>("SELECT state FROM outbox WHERE key = $1", [key]);
    if (row?.state === "sent") return true;
    if (!mailUp) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export function startOutbox(): void {
  setInterval(() => void drain(), TICK_MS);
  const probe = async (): Promise<void> => {
    const up = await probeMail();
    if (up && !mailUp) {
      await query("UPDATE outbox SET next_attempt_at = clock_timestamp() WHERE instance = $1 AND state = 'pending'", [instanceId]).catch(() => undefined);
      mailUp = true;
      wakeOutbox();
    } else {
      mailUp = up;
    }
    setTimeout(() => void probe(), PROBE_EVERY_MS);
  };
  void probe();
}
