/**
 * Email: every message is queued in Postgres inside the action's transaction and delivered to
 * the SMTP sink by a worker that retries every 10 seconds, so no action waits on or fails for mail.
 */
import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { type Db, transaction } from "./db.js";

export interface Email {
  to: string;
  subject: string;
  body: string;
}

export async function queueEmail(db: Db, email: Email): Promise<void> {
  await db.query("INSERT INTO outgoing_emails (recipient, subject, body) VALUES ($1, $2, $3)", [
    email.to,
    email.subject,
    email.body,
  ]);
}

const SMTP_TIMEOUT_MS = 10_000;
const fromAddress = /<([^>]+)>/.exec(config.smtp.from)?.[1] ?? config.smtp.from;

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function message(email: Email): string {
  const body = email.body
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: ${email.to}`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@crosshand-relay>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

/** One SMTP conversation: EHLO, MAIL FROM, RCPT TO, DATA, QUIT. */
function deliver(email: Email): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error("SMTP timed out")));
    const steps: { send: string | null; expect: number }[] = [
      { send: null, expect: 220 },
      { send: "EHLO crosshand-relay", expect: 250 },
      { send: `MAIL FROM:<${fromAddress}>`, expect: 250 },
      { send: `RCPT TO:<${email.to}>`, expect: 250 },
      { send: "DATA", expect: 354 },
      { send: `${message(email)}\r\n.`, expect: 250 },
      { send: "QUIT", expect: 221 },
    ];
    let buffer = "";
    let step = 0;
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const current = steps[step];
        if (!current || code !== current.expect) {
          socket.destroy(new Error(`SMTP answered ${line}`));
          return;
        }
        step += 1;
        const next = steps[step];
        if (!next) {
          socket.end();
          return;
        }
        socket.write(`${next.send}\r\n`);
      }
    });
    socket.on("error", reject);
    socket.on("close", () => (step === steps.length ? resolve() : reject(new Error("SMTP connection closed early"))));
  });
}

interface QueuedRow {
  id: string;
  recipient: string;
  subject: string;
  body: string;
}

/** Sends what is queued; rows stay locked while sending, so several instances never send twice. */
async function deliverQueued(): Promise<void> {
  await transaction(async (client) => {
    const { rows } = await client.query<QueuedRow>(
      `SELECT id, recipient, subject, body FROM outgoing_emails WHERE sent_at IS NULL
       ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows) {
      try {
        await deliver({ to: row.recipient, subject: row.subject, body: row.body });
      } catch (error) {
        console.error("email delivery deferred:", error instanceof Error ? error.message : error);
        continue;
      }
      await client.query("UPDATE outgoing_emails SET sent_at = now() WHERE id = $1", [row.id]);
    }
  }).catch((error: Error) => console.error("email queue unavailable:", error.message));
}

let running: Promise<void> | null = null;
let again = false;

/** Delivers soon; called after every committed action that queued mail, and by the 10 s timer. */
export function flushEmails(): void {
  if (running) {
    again = true;
    return;
  }
  running = deliverQueued().finally(() => {
    running = null;
    if (again) {
      again = false;
      flushEmails();
    }
  });
}

export const EMAIL_RETRY_MS = 10_000;
