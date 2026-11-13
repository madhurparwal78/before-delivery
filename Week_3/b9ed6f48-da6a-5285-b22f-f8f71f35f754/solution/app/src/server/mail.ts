// Outbound mail (brief: Services › Mailpit). Every message is queued in PostgreSQL inside the
// transaction that caused it, tried at once, and otherwise delivered by whichever instance can
// reach the SMTP server, exactly once (the row lock decides who sends it).

import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "./config.js";
import { pool, type Db } from "./db.js";

interface Recipient {
  email: string;
  name: string;
}

export async function queueMail(db: Db, to: Recipient, subject: string, body: string): Promise<number> {
  const result = await db.query<{ id: number }>("INSERT INTO mail_queue (to_address, to_name, subject, body) VALUES ($1, $2, $3, $4) RETURNING id", [
    to.email,
    to.name,
    subject,
    body,
  ]);
  return result.rows[0].id;
}

const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);
const encodedWord = (s: string) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

function address(value: string): string {
  const m = /^(.*)<([^>]+)>\s*$/.exec(value);
  return m ? m[2].trim() : value.trim();
}

function fromHeader(): string {
  const m = /^(.*)<([^>]+)>\s*$/.exec(config.mail.from);
  return m ? `${encodedWord(m[1].trim())} <${m[2].trim()}>` : config.mail.from;
}

function message(to: Recipient, subject: string, body: string): string {
  const quotedName = to.name.replace(/["\\\r\n]/g, "");
  const text = Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${fromHeader()}`,
    `To: ${ascii(quotedName) ? `"${quotedName}"` : encodedWord(quotedName)} <${to.email}>`,
    `Subject: ${encodedWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${address(config.mail.from).split("@")[1] ?? "halden.test"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    text,
  ].join("\r\n");
}

/** A minimal SMTP conversation: EHLO, MAIL, RCPT, DATA, QUIT. */
function smtpSend(to: Recipient, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(10_000);
    const steps = [
      { expect: 220, send: "EHLO halden.sightline" },
      { expect: 250, send: `MAIL FROM:<${address(config.mail.from)}>` },
      { expect: 250, send: `RCPT TO:<${to.email}>` },
      { expect: 250, send: "DATA" },
      { expect: 354, send: `${message(to, subject, body).replace(/^\./gm, "..")}\r\n.` },
      { expect: 250, send: "QUIT" },
    ];
    let buffer = "";
    let step = 0;
    const finish = (error?: Error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (step === steps.length) return finish();
        if (code !== steps[step].expect) return finish(new Error(`SMTP ${line}`));
        socket.write(`${steps[step].send}\r\n`);
        step++;
      }
    });
    socket.on("timeout", () => finish(new Error("SMTP timeout")));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => (step === steps.length ? resolve() : reject(new Error("SMTP closed"))));
  });
}

type Delivery = "sent" | "locked" | "failed";

/** Sends one queued message unless it is already sent; the row lock makes it exactly once. */
async function deliver(id: number, skipLocked: boolean): Promise<Delivery> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (
      await client.query<{ to_address: string; to_name: string; subject: string; body: string; sent_at: Date | null }>(
        `SELECT to_address, to_name, subject, body, sent_at FROM mail_queue WHERE id = $1 FOR UPDATE${skipLocked ? " SKIP LOCKED" : ""}`,
        [id],
      )
    ).rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return "locked";
    }
    if (row.sent_at === null) {
      await smtpSend({ email: row.to_address, name: row.to_name }, row.subject, row.body);
      await client.query("UPDATE mail_queue SET sent_at = now() WHERE id = $1", [id]);
    }
    await client.query("COMMIT");
    return "sent";
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return "failed";
  } finally {
    client.release();
  }
}

/** Tries queued messages now; "delayed" when any could not be delivered yet. */
export async function deliverNow(ids: number[]): Promise<"sent" | "delayed"> {
  let sent = true;
  for (const id of ids) sent = (await deliver(id, false)) === "sent" && sent;
  return sent ? "sent" : "delayed";
}

/** The worker: delivers every unsent message this instance can reach. */
export async function deliverQueued(): Promise<void> {
  const pending = await pool.query<{ id: number }>("SELECT id FROM mail_queue WHERE sent_at IS NULL ORDER BY id LIMIT 50");
  for (const { id } of pending.rows) if ((await deliver(id, true)) === "failed") return;
}
