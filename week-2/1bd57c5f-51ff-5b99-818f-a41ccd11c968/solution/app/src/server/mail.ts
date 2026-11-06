import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "./config";
import { maybeOne, pool, rows, type Db } from "./db";

// The mail outbox. Every email is written to the outbox in the same transaction as the
// change that caused it; a sender claims queued entries in Postgres and delivers each
// through SMTP (no authentication or TLS) until the server accepts it, exactly once.

interface OutboxMessage {
  jobId: string;
  kind: "assignment" | "summary";
  to: string;
  subject: string;
  body: string;
}

export async function queueEmail(db: Db, message: OutboxMessage): Promise<void> {
  await db.query("INSERT INTO outbox (id, job_id, kind, to_email, subject, body) VALUES ($1, $2, $3, $4, $5, $6)", [
    randomUUID(),
    message.jobId,
    message.kind,
    message.to,
    message.subject,
    message.body,
  ]);
}

export function signInLine(): string {
  return `Sign in to see the details: ${config.publicUrl}/signin`;
}

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function formatMessage(id: string, to: string, subject: string, body: string): string {
  const encoded = Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${config.mailFrom}`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${id}@snaglight.example>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
  ].join("\r\n");
}

/** A minimal SMTP conversation: one message, then QUIT. Rejects on any non-success reply. */
function smtpSend(to: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP timed out")));
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("SMTP connection closed early")));
    const steps: Array<{ send: string | null; expect: number }> = [
      { send: null, expect: 220 },
      { send: "EHLO snaglight.example", expect: 250 },
      { send: `MAIL FROM:<${address(config.mailFrom)}>`, expect: 250 },
      { send: `RCPT TO:<${to}>`, expect: 250 },
      { send: "DATA", expect: 354 },
      { send: `${data.replace(/^\./gm, "..")}\r\n.`, expect: 250 },
      { send: "QUIT", expect: 221 },
    ];
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length < 4 || line[3] === "-") continue;
        const step = steps.shift();
        if (!step || Number(line.slice(0, 3)) !== step.expect) {
          socket.destroy();
          reject(new Error(`SMTP refused: ${line}`));
          return;
        }
        const next = steps[0];
        if (!next) {
          socket.end();
          resolve();
          return;
        }
        if (next.send !== null) socket.write(`${next.send}\r\n`);
      }
    });
  });
}

interface ClaimedEntry {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

/** Claims the oldest queued entry; the claim lapses after five minutes if a sender dies mid-send. */
function claimNext(): Promise<ClaimedEntry | null> {
  return maybeOne<ClaimedEntry>(
    pool,
    `UPDATE outbox SET claimed_until = clock_timestamp() + interval '5 minutes'
     WHERE id = (
       SELECT id FROM outbox
       WHERE status = 'queued' AND (claimed_until IS NULL OR claimed_until < clock_timestamp())
       ORDER BY position FOR UPDATE SKIP LOCKED LIMIT 1
     )
     RETURNING id, to_email, subject, body`,
  );
}

let sending = false;
let again = false;

/** Delivers queued entries until the queue is empty or SMTP refuses; safe to call any time. */
export async function sendQueuedMail(): Promise<void> {
  if (sending) {
    again = true;
    return;
  }
  sending = true;
  try {
    do {
      again = false;
      for (let entry = await claimNext(); entry; entry = await claimNext()) {
        try {
          await smtpSend(entry.to_email, formatMessage(entry.id, entry.to_email, entry.subject, entry.body));
        } catch (error) {
          await pool.query("UPDATE outbox SET claimed_until = NULL WHERE id = $1", [entry.id]);
          console.error("mail not sent yet:", (error as Error).message);
          return;
        }
        await pool.query("UPDATE outbox SET status = 'sent', sent_at = clock_timestamp(), claimed_until = NULL WHERE id = $1", [
          entry.id,
        ]);
      }
    } while (again);
  } catch (error) {
    console.error("outbox sender failed:", (error as Error).message);
  } finally {
    sending = false;
  }
}

export function startMailSender(): void {
  void sendQueuedMail();
  setInterval(() => void sendQueuedMail(), 10_000).unref();
}

interface OutboxRow {
  id: string;
  kind: "assignment" | "summary";
  to_email: string;
  subject: string;
  status: "queued" | "sent";
  created_at: string;
  sent_at: string | null;
}

export function loadOutbox(db: Db, jobId: string): Promise<OutboxRow[]> {
  return rows<OutboxRow>(
    db,
    "SELECT id, kind, to_email, subject, status, created_at, sent_at FROM outbox WHERE job_id = $1 ORDER BY position DESC",
    [jobId],
  );
}
