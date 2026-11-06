import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "../config.js";
import { tx, type Db } from "../db.js";

// Mail: an outbox row written in the same transaction as the change that caused it, delivered over SMTP
// by whichever app copy claims it first (FOR UPDATE SKIP LOCKED), so each message goes out exactly once.

const FROM_ADDRESS = "plumbline@marrowhall.example";
const FROM = `Plumbline <${FROM_ADDRESS}>`;
const POLL_MS = 500;
const RETRY_SECONDS = 10;

interface Attachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface Message {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: Attachment[];
}

export async function queueMail(db: Db, message: Message): Promise<void> {
  await db.query("INSERT INTO outbox (to_address, subject, body, reply_to, attachments) VALUES ($1, $2, $3, $4, $5)",
    [message.to, message.subject, message.text, message.replyTo ?? null, JSON.stringify(message.attachments ?? [])]);
}

interface OutboxRow {
  id: number;
  to_address: string;
  subject: string;
  body: string;
  reply_to: string | null;
  attachments: Attachment[];
}

/** Delivers pending messages until the process ends; Mailpit being down only delays them. */
export function startOutbox(): void {
  const tick = async (): Promise<void> => {
    try {
      while (await deliverOne()) { /* drain the queue */ }
    } catch (error) {
      console.error("outbox:", (error as Error).message);
    }
    setTimeout(tick, POLL_MS);
  };
  setTimeout(tick, POLL_MS);
}

async function deliverOne(): Promise<boolean> {
  return tx(async (client) => {
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, to_address, subject, body, reply_to, attachments FROM outbox
       WHERE sent_at IS NULL AND next_attempt_at <= now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const row = rows[0];
    if (!row) return false;
    try {
      await smtpSend(row.to_address, mime(row));
      await client.query("UPDATE outbox SET sent_at = now() WHERE id = $1", [row.id]);
    } catch (error) {
      console.error("smtp:", (error as Error).message);
      await client.query(`UPDATE outbox SET next_attempt_at = now() + interval '${RETRY_SECONDS} seconds' WHERE id = $1`, [row.id]);
      return false;
    }
    return true;
  });
}

// MIME

const base64Lines = (text: string): string => Buffer.from(text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");

/** A header value as RFC 2047 encoded words whenever it holds anything but printable ASCII. */
function headerText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join("\r\n ");
}

function mime(row: OutboxRow): string {
  const boundary = `plumbline-${randomUUID()}`;
  const headers = [
    `From: ${FROM}`,
    `To: <${row.to_address}>`,
    ...(row.reply_to ? [`Reply-To: <${row.reply_to}>`] : []),
    `Subject: ${headerText(row.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@marrowhall.example>`,
    "MIME-Version: 1.0",
  ];
  const text = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(row.body)];
  if (!row.attachments.length) return [...headers, ...text].join("\r\n");
  const parts = [`--${boundary}`, ...text];
  for (const attachment of row.attachments) {
    parts.push(`--${boundary}`, `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`, "Content-Transfer-Encoding: base64", "",
      base64Lines(attachment.content));
  }
  parts.push(`--${boundary}--`);
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

// SMTP

function smtpSend(to: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000, () => socket.destroy(new Error("smtp timeout")));
    const steps = [
      "EHLO plumbline",
      `MAIL FROM:<${FROM_ADDRESS}>`,
      `RCPT TO:<${to}>`,
      "DATA",
      `${data.replace(/^\./gm, "..")}\r\n.`,
      "QUIT",
    ];
    const payloadStep = steps.length - 2;
    // Once the server accepts the message data it is delivered; a later failure must not cause a resend.
    let delivered = false;
    let buffer = "";
    let step = -1;
    const finish = (error?: Error): void => {
      if (delivered) resolve();
      else reject(error ?? new Error("smtp connection closed"));
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // A reply is complete when its last line has a space after the code.
      const complete = buffer.split("\r\n").slice(0, -1);
      const last = complete.findLast((line) => /^\d{3} /.test(line));
      if (!last) return;
      buffer = "";
      if (Number(last.slice(0, 3)) >= 400) {
        socket.destroy();
        finish(new Error(`smtp ${last}`));
        return;
      }
      if (step === payloadStep) delivered = true;
      step++;
      if (step < steps.length) socket.write(`${steps[step]}\r\n`);
      else socket.end();
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish());
  });
}
