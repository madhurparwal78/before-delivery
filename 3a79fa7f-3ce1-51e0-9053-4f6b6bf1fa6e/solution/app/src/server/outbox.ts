// The notice outbox sender: every instance checks every second; a session advisory lock lets one instance send
// at a time, oldest due notice first, each at most once. Retries run on real elapsed time. An instance whose
// mail is unreachable leaves due notices to any instance with reachable mail that is running.
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { iso, now } from "./clock.ts";
import { sendMail } from "./smtp.ts";

const SENDER_LOCK = 7_340_002;
const CHECK_MS = 1_000;
const INSTANCE = randomUUID();
let mailReachable = true;

interface Due {
  id: string;
  to_addr: string;
  subject: string;
  body: string;
  attempts: number;
  reset_token_id: number | null;
}

/** Seconds until the next attempt after failed attempt n: 5, 10, 20, 40, then every 60. */
function retryDelay(attempt: number): number {
  return Math.min(60, 5 * 2 ** (attempt - 1));
}

async function compose(notice: Due): Promise<string> {
  if (notice.reset_token_id === null) return notice.body;
  const { rows } = await pool.query<{ mail_token: string | null }>("SELECT mail_token FROM reset_tokens WHERE id = $1", [notice.reset_token_id]);
  const link = `${config.publicUrl}/reset-password?token=${rows[0]?.mail_token ?? ""}`;
  return notice.body.replace("{reset_link}", link);
}

/** Records this instance's mail health; true when another running instance can reach mail and this one cannot. */
async function deferToPeer(): Promise<boolean> {
  await pool.query(
    `INSERT INTO sender_heartbeats (instance, mail_ok, seen_at) VALUES ($1, $2, clock_timestamp())
     ON CONFLICT (instance) DO UPDATE SET mail_ok = EXCLUDED.mail_ok, seen_at = EXCLUDED.seen_at`,
    [INSTANCE, mailReachable],
  );
  if (mailReachable) return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM sender_heartbeats WHERE instance <> $1 AND mail_ok AND seen_at > clock_timestamp() - interval '5 seconds'",
    [INSTANCE],
  );
  return rows.length > 0;
}

async function sendDue(): Promise<void> {
  if (await deferToPeer()) return;
  const client = await pool.connect();
  try {
    const { rows: lock } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [SENDER_LOCK]);
    if (!lock[0]?.ok) return;
    try {
      const { rows } = await client.query<Due>(
        `SELECT id, to_addr, subject, body, attempts, reset_token_id FROM outbox
         WHERE status = 'pending' AND next_attempt_at <= clock_timestamp() ORDER BY id LIMIT 50`,
      );
      for (const notice of rows) {
        const attempt = notice.attempts + 1;
        try {
          await sendMail(notice.to_addr, notice.subject, await compose(notice));
          mailReachable = true;
          await client.query("UPDATE outbox SET status = 'sent', attempts = $2, sent_at = $3 WHERE id = $1", [notice.id, attempt, now()]);
          if (notice.reset_token_id !== null) await client.query("UPDATE reset_tokens SET mail_token = NULL WHERE id = $1", [notice.reset_token_id]);
        } catch {
          mailReachable = false;
          await client.query(
            "UPDATE outbox SET attempts = $2, next_attempt_at = clock_timestamp() + make_interval(secs => $3) WHERE id = $1",
            [notice.id, attempt, retryDelay(attempt)],
          );
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SENDER_LOCK]);
    }
  } finally {
    client.release();
  }
}

export async function listOutbox(): Promise<object[]> {
  const { rows } = await pool.query<{ id: string; to: string; template: string; reference: string | null; subject: string; status: string; attempts: number; created_at: Date; sent_at: Date | null }>(
    "SELECT id, to_addr AS to, template, reference, subject, status, attempts, created_at, sent_at FROM outbox ORDER BY created_at DESC, id DESC",
  );
  return rows.map((n) => ({
    id: Number(n.id), to: n.to, template: n.template, reference: n.reference, subject: n.subject, status: n.status, attempts: n.attempts,
    created_at: iso(n.created_at), sent_at: n.sent_at ? iso(n.sent_at) : null,
  }));
}

let running = false;
let again = false;

async function run(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await sendDue();
    } while (again);
  } catch (error) {
    console.error("outbox sender:", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

/** Runs the sender soon, after the queuing transaction has committed. */
export function wakeSender(): void {
  setTimeout(() => void run(), 100);
}

export function startSender(): void {
  setInterval(() => void run(), CHECK_MS);
}
