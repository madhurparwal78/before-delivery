// Mail: messages are queued in Postgres with the change they report, then delivered over SMTP
// once accepted, retrying every 30 seconds. Each queued row is sent by exactly one process.
import { connect, type Socket } from "node:net";
import type { Db } from "../db.js";
import { pool, rows } from "../db.js";
import { config } from "../config.js";

export async function queueMail(db: Db, to: string, subject: string, body: string): Promise<void> {
  await db.query(`INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)`, [to, subject, body]);
}

function address(value: string): string {
  const m = /<([^>]+)>/.exec(value);
  return (m ? m[1]! : value).trim();
}

function encodeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function encodeFrom(value: string): string {
  const m = /^(.*)<([^>]+)>\s*$/.exec(value);
  return m ? `${encodeHeader(m[1]!.trim())} <${m[2]}>` : value;
}

function smtpConversation(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP timeout")));
    const message = [
      `From: ${encodeFrom(config.smtp.from)}`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
    ].join("\r\n");
    const steps = [
      `EHLO pegworth.local`,
      `MAIL FROM:<${address(config.smtp.from)}>`,
      `RCPT TO:<${to}>`,
      "DATA",
      `${message}\r\n.`,
      "QUIT",
    ];
    const expected = [220, 250, 250, 250, 354, 250, 221];
    let buffer = "";
    let step = 0;
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      while (true) {
        const lines = buffer.split("\r\n");
        const done = lines.findIndex((line) => /^\d{3} /.test(line));
        if (done === -1) return;
        const code = Number(lines[done]!.slice(0, 3));
        buffer = lines.slice(done + 1).join("\r\n");
        if (code !== expected[step]) {
          socket.destroy();
          reject(new Error(`SMTP answered ${code} at step ${step}`));
          return;
        }
        if (step === steps.length) {
          socket.end();
          resolve();
          return;
        }
        socket.write(`${steps[step]}\r\n`);
        step += 1;
      }
    });
    socket.on("error", reject);
  });
}

/** Sends every due message; a refused one waits 30 seconds before its next attempt. */
export async function deliverMail(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const due = await rows<{ id: number; recipient: string; subject: string; body: string }>(
      client,
      `SELECT id, recipient, subject, body FROM mail_outbox WHERE sent_at IS NULL AND next_attempt_at <= now()
       ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`,
    );
    for (const message of due) {
      try {
        await smtpConversation(message.recipient, message.subject, message.body);
        await client.query(`UPDATE mail_outbox SET sent_at = now() WHERE id = $1`, [message.id]);
      } catch {
        await client.query(`UPDATE mail_outbox SET next_attempt_at = now() + interval '30 seconds' WHERE id = $1`, [message.id]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
