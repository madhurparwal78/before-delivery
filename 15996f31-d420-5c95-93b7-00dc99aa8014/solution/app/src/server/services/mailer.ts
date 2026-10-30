// SMTP to the Mailpit sink, from MAIL_FROM. Messages are queued in the outbox inside the transaction that
// triggers them and sent only after it commits; the sender retries every 10 s until each is delivered once.

import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "../config.js";
import { pool, type Db } from "../db.js";

interface Mail {
  to: string;
  subject: string;
  body: string;
}

export async function queueMail(db: Db, mail: Mail): Promise<void> {
  await db.query("INSERT INTO outbox (to_address, subject, body) VALUES ($1, $2, $3)", [mail.to, mail.subject, mail.body]);
}

function address(header: string): string {
  const match = /<([^>]+)>/.exec(header);
  return (match ? match[1] : header).trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeFrom(value: string): string {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(value);
  return match ? `${encodeHeader(match[1].replace(/^"|"$/g, ""))} <${match[2]}>` : value;
}

function compose(mail: Mail): string {
  const body = Buffer.from(mail.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${encodeFrom(config.smtp.from)}`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${address(config.smtp.from).split("@")[1] ?? "localhost"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** One SMTP conversation: EHLO, MAIL, RCPT, DATA, QUIT. */
function deliver(mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP timed out")));
    const steps = [
      `EHLO bloom-desk`,
      `MAIL FROM:<${address(config.smtp.from)}>`,
      `RCPT TO:<${mail.to}>`,
      "DATA",
      `${compose(mail)}\r\n.`,
      "QUIT",
    ];
    let buffer = "";
    let step = -1;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) {
          socket.destroy(new Error(`SMTP refused: ${line}`));
          return;
        }
        step += 1;
        if (step < steps.length) socket.write(`${steps[step]}\r\n`);
        else socket.end();
      }
    });
    socket.on("error", reject);
    socket.on("close", (failed) => (failed ? reject(new Error("SMTP connection closed")) : step >= steps.length ? resolve() : reject(new Error("SMTP ended early"))));
  });
}

let sending = false;

/** Sends every unsent outbox message once; a row stays locked while it is being sent. */
export async function flushOutbox(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    for (;;) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ id: number; to_address: string; subject: string; body: string }>(
          "SELECT id, to_address, subject, body FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
        );
        const next = rows[0];
        if (!next) {
          await client.query("COMMIT");
          return;
        }
        await deliver({ to: next.to_address, subject: next.subject, body: next.body });
        await client.query("UPDATE outbox SET sent_at = now() WHERE id = $1", [next.id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        console.error("outbox:", error instanceof Error ? error.message : error);
        return;
      } finally {
        client.release();
      }
    }
  } finally {
    sending = false;
  }
}
