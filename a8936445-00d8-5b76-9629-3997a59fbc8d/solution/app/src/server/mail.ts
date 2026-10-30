// Email over SMTP. A message counts as sent only when the server accepts it after the data.
import net from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { pool, type Queryable } from "./db";
import { ProviderError } from "./errors";

const FROM_NAME = "Stationkeeper at Larder Row Kitchen";
const FROM_ADDRESS = "bookings@larderrow.test";
const STAGE_TIMEOUT_MS = 10_000;

export interface Email {
  to: string;
  subject: string;
  body: string;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function compose(email: Email): string {
  const body = Buffer.from(email.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${encodeHeader(FROM_NAME)} <${FROM_ADDRESS}>`,
    `To: <${email.to}>`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@larderrow.test>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** One SMTP conversation; resolves only when the server accepted the message data. */
export function sendEmail(email: Email): Promise<void> {
  if (/[\r\n<>]/.test(email.to)) return Promise.reject(new ProviderError("mail", "unsafe recipient"));
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    let buffer = "";
    let waiting: ((code: number) => void) | null = null;
    let settled = false;
    const fail = (detail: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new ProviderError("mail", detail));
    };
    socket.setTimeout(STAGE_TIMEOUT_MS, () => fail("no reply within 10 seconds"));
    socket.on("error", (error) => fail(error.message));
    socket.on("close", () => fail("connection closed"));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) waiting?.(Number(line.slice(0, 3)));
      }
    });
    const reply = (): Promise<number> => new Promise((done) => (waiting = done));
    const step = async (command: string | null, accepted: number[]): Promise<void> => {
      const next = reply();
      if (command !== null) socket.write(`${command}\r\n`);
      const code = await next;
      if (!accepted.includes(code)) throw new Error(`${command ?? "greeting"} answered ${code}`);
    };
    (async () => {
      await step(null, [220]);
      await step("EHLO stationkeeper", [250]);
      await step(`MAIL FROM:<${FROM_ADDRESS}>`, [250]);
      await step(`RCPT TO:<${email.to}>`, [250, 251]);
      await step("DATA", [354]);
      await step(`${compose(email)}\r\n.`, [250]);
      settled = true;
      resolve();
      socket.end("QUIT\r\n");
    })().catch((error: Error) => fail(error.message));
  });
}

/** Queues an email inside the caller's transaction, so it exists exactly when the action commits. */
export async function queueEmail(db: Queryable, email: Email): Promise<void> {
  await db.query("INSERT INTO email_queue (id, to_email, subject, body) VALUES ($1, $2, $3, $4)", [randomUUID(), email.to, email.subject, email.body]);
}

/** Delivers queued emails one at a time; each is marked delivered only after SMTP accepts it. */
export async function deliverQueuedEmails(): Promise<void> {
  for (;;) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const next = (
        await client.query<{ id: string; to_email: string; subject: string; body: string }>(
          "SELECT id, to_email, subject, body FROM email_queue WHERE delivered_at IS NULL ORDER BY queued_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
      ).rows[0];
      if (!next) {
        await client.query("COMMIT");
        return;
      }
      try {
        await sendEmail({ to: next.to_email, subject: next.subject, body: next.body });
      } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof ProviderError) return;
        throw error;
      }
      await client.query("UPDATE email_queue SET delivered_at = now() WHERE id = $1", [next.id]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  }
}
