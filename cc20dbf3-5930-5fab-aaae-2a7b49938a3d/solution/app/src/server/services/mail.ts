// Member email: queued in PostgreSQL in the same transaction as the change it reports, then sent over
// SMTP by the background worker, exactly once.

import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "../config.js";
import { type Db, pool } from "../db.js";
import { describeError } from "../log.js";

const SMTP_TIMEOUT_MS = 5_000;

export async function queueEmail(db: Db, recipient: string, subject: string, lines: readonly string[], now: Date): Promise<void> {
  await db.query("INSERT INTO outbox_email (id, recipient, subject, body, created_at) VALUES ($1, $2, $3, $4, $5)", [
    randomUUID(),
    recipient,
    subject,
    lines.join("\n"),
    now,
  ]);
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return (match?.[1] ?? mailbox).trim();
}

function fromHeader(mailbox: string): string {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(mailbox);
  if (!match?.[1]) return addressOf(mailbox);
  return `"${match[1].replace(/["\\]/g, "\\$&")}" <${match[2]}>`;
}

/** A plain SMTP conversation: no auth and no TLS, as the configured relay expects. */
class SmtpConversation {
  private buffer = "";
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on("error", (error) => this.failed?.(error));
    socket.on("timeout", () => {
      this.failed?.(new Error("SMTP timed out"));
      socket.destroy();
    });
  }

  static open(): Promise<SmtpConversation> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: config.smtp.host, port: config.smtp.port });
      socket.setTimeout(SMTP_TIMEOUT_MS);
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.off("error", reject);
        resolve(new SmtpConversation(socket));
      });
    });
  }

  private deliver(): void {
    const lines = this.buffer.split("\r\n");
    const lastIndex = lines.findIndex((line) => /^\d{3} /.test(line));
    if (lastIndex === -1 || !this.waiting) return;
    const reply = lines.slice(0, lastIndex + 1);
    this.buffer = lines.slice(lastIndex + 1).join("\r\n");
    const resolve = this.waiting;
    this.waiting = null;
    resolve({ code: Number(reply[lastIndex]?.slice(0, 3)), text: reply.join("\n") });
  }

  expect(code: number, command?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.failed = reject;
      this.waiting = (reply) => (reply.code === code ? resolve() : reject(new Error(`SMTP answered ${reply.code}`)));
      if (command !== undefined) this.socket.write(`${command}\r\n`);
      this.deliver();
    });
  }

  close(): void {
    this.socket.end();
  }
}

function message(recipient: string, subject: string, body: string, id: string, sentAt: Date): string {
  const text = body
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
  return [
    `From: ${fromHeader(config.smtp.from)}`,
    `To: <${recipient}>`,
    `Subject: ${subject}`,
    `Date: ${sentAt.toUTCString()}`,
    `Message-ID: <${id}@shedline>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    ".",
  ].join("\r\n");
}

async function deliver(recipient: string, subject: string, body: string, id: string): Promise<void> {
  const smtp = await SmtpConversation.open();
  try {
    await smtp.expect(220);
    await smtp.expect(250, "EHLO shedline");
    await smtp.expect(250, `MAIL FROM:<${addressOf(config.smtp.from)}>`);
    await smtp.expect(250, `RCPT TO:<${recipient}>`);
    await smtp.expect(354, "DATA");
    await smtp.expect(250, message(recipient, subject, body, id, new Date()));
    await smtp.expect(221, "QUIT");
  } finally {
    smtp.close();
  }
}

/** Sends queued email one message at a time; a row is locked while it is sent so no other copy sends it. */
export async function sendQueuedEmail(): Promise<void> {
  for (;;) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const next = await db.query<{ id: string; recipient: string; subject: string; body: string }>(
        `SELECT id, recipient, subject, body FROM outbox_email WHERE sent_at IS NULL
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const row = next.rows[0];
      if (!row) {
        await db.query("COMMIT");
        return;
      }
      await deliver(row.recipient, row.subject, row.body, row.id);
      await db.query("UPDATE outbox_email SET sent_at = $2 WHERE id = $1", [row.id, new Date()]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      console.error(`email send failed, will retry: ${describeError(error)}`);
      return;
    } finally {
      db.release();
    }
  }
}
