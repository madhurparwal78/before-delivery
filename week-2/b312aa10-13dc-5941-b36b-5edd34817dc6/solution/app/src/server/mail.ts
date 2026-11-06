// Outgoing email: written to the outbox inside the transaction that causes it, delivered over SMTP
// by the worker, retried until it succeeds, one recipient per message.

import { connect, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";
import { pool } from "./db.js";

export async function queueMail(client: pg.PoolClient, to: string, subject: string, lines: string[]): Promise<void> {
  await client.query("INSERT INTO mail_outbox (to_address, subject, body) VALUES ($1, $2, $3)", [to, subject, lines.join("\n")]);
  // PostgreSQL delivers the notice only when the transaction commits, so the worker wakes for committed mail.
  await client.query("NOTIFY mail_outbox");
}

const fromAddress = (): string => /<([^>]+)>/.exec(config.mail.from)?.[1] ?? config.mail.from.trim();
const encodeHeader = (text: string): string =>
  /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;

/** An address for the envelope and the To header: a local part that is not a plain dot-atom is quoted (RFC 5321). */
function mailbox(address: string): string {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  return /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)
    ? address
    : `"${local.replace(/["\\]/g, "\\$&")}"${address.slice(at)}`;
}

function message(to: string, subject: string, body: string): string {
  const base64 = Buffer.from(body.replace(/\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${config.mail.from}`,
    `To: <${mailbox(to)}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@lineboard.example>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64,
  ].join("\r\n");
}

/** One SMTP conversation: send each command and wait for the expected reply code. */
function smtpSend(to: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP timeout")));
    const steps: Array<[string | null, number]> = [
      [null, 220], ["EHLO lineboard", 250], [`MAIL FROM:<${fromAddress()}>`, 250], [`RCPT TO:<${mailbox(to)}>`, 250],
      ["DATA", 354], [`${data.replace(/^\./gm, "..")}\r\n.`, 250], ["QUIT", 221],
    ];
    let buffer = "";
    let step = 0;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code !== steps[step]![1]) {
          socket.destroy();
          reject(new Error(`SMTP answered ${line}`));
          return;
        }
        step += 1;
        if (step === steps.length) {
          socket.end();
          resolve();
          return;
        }
        socket.write(`${steps[step]![0]}\r\n`);
      }
    });
    socket.on("error", reject);
  });
}

let running = false;
let again = false;

/** Delivers queued mail; several instances may share the outbox, so each row is locked while sent. */
export async function deliverMail(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await deliverPass();
    } while (again);
  } finally {
    running = false;
  }
}

/** Wakes the worker whenever any instance commits mail to the outbox. */
export async function listenForMail(): Promise<void> {
  const client = await pool.connect();
  client.on("notification", () => void deliverMail().catch((error: Error) => console.error(`mail: ${error.message}`)));
  client.on("error", (error) => {
    console.error(`mail listener: ${error.message}`);
    client.release(error);
    setTimeout(() => void listenForMail().catch(() => undefined), 1000);
  });
  await client.query("LISTEN mail_outbox");
}

async function deliverPass(): Promise<void> {
  for (;;) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT id, to_address, subject, body, attempts FROM mail_outbox
          WHERE sent_at IS NULL AND next_attempt_at <= now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const row = rows[0];
      if (!row) {
        await client.query("COMMIT");
        return;
      }
      try {
        await smtpSend(row.to_address, message(row.to_address, row.subject, row.body));
        await client.query("UPDATE mail_outbox SET sent_at = now() WHERE id = $1", [row.id]);
      } catch (error) {
        // A message that cannot be sent waits with backoff; it never holds up the messages behind it.
        console.error(`mail delivery waiting: ${(error as Error).message}`);
        await client.query(
          "UPDATE mail_outbox SET attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => $2) WHERE id = $1",
          [row.id, Math.min(60, 2 ** (row.attempts as number))],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`mail delivery waiting: ${(error as Error).message}`);
      return;
    } finally {
      client.release();
    }
  }
}
