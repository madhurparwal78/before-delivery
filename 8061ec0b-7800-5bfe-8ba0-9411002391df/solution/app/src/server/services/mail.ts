// Email: queued in the action's own transaction (an outbox row), then delivered over SMTP by a dispatcher that
// retries until it succeeds. `FOR UPDATE SKIP LOCKED` keeps instances sharing a database from sending twice.

import { connect, type Socket } from "node:net";
import { config } from "../config.js";
import { now } from "../clock.js";
import { checkout, query, type Db } from "../db/pool.js";

interface Email { to: string; subject: string; body: string }

export async function queueEmail(db: Db, email: Email): Promise<void> {
  await db.query("INSERT INTO outbox_emails (recipient, subject, body, queued_at) VALUES ($1, $2, $3, $4)",
    [email.to, email.subject, email.body, now()]);
  setImmediate(kickDispatcher);
}

const sender = (() => {
  const match = /^(.*)<([^>]+)>\s*$/.exec(config.smtp.from);
  return match ? { name: match[1].trim(), address: match[2].trim() } : { name: "", address: config.smtp.from.trim() };
})();

function encodeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function message(email: Email): string {
  const from = sender.name ? `${encodeHeader(`"${sender.name}"`)} <${sender.address}>` : sender.address;
  const body = Buffer.from(email.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${from}`, `To: <${email.to}>`, `Subject: ${encodeHeader(email.subject)}`, `Date: ${now().toUTCString()}`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", body, "",
  ].join("\r\n");
}

/** One SMTP conversation: EHLO, MAIL FROM, RCPT TO, DATA, QUIT. */
function smtpSend(email: Email): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP timeout")));
    const steps: [string | null, number][] = [
      [null, 220], ["EHLO bellroll", 250], [`MAIL FROM:<${sender.address}>`, 250], [`RCPT TO:<${email.to}>`, 250],
      ["DATA", 354], [`${message(email).replace(/^\./gm, "..")}\r\n.`, 250], ["QUIT", 221],
    ];
    let buffer = "";
    let step = 0;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      const last = lines.findLast((line) => /^\d{3} /.test(line));
      if (last === undefined) return;
      buffer = "";
      const code = Number(last.slice(0, 3));
      if (code !== steps[step][1]) {
        socket.destroy(new Error(`SMTP ${code}: ${last}`));
        return;
      }
      step += 1;
      if (step === steps.length) {
        socket.end();
        resolve();
        return;
      }
      socket.write(`${steps[step][0]}\r\n`);
    });
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("SMTP connection closed")));
  });
}

let running = false;
let again = false;

/** Sends every pending email; a failed send is retried on the next pass. */
function kickDispatcher(): void {
  if (running) {
    again = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        again = false;
        await deliverPending();
      } while (again);
    } catch (error) {
      console.error("outbox delivery failed; will retry", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  })();
}

async function deliverPending(): Promise<void> {
  const client = await checkout();
  try {
    await client.query("BEGIN");
    const pending = await query<{ id: number; recipient: string; subject: string; body: string }>(client,
      `SELECT id, recipient, subject, body FROM outbox_emails WHERE sent_at IS NULL
       ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`);
    for (const email of pending) {
      try {
        await smtpSend({ to: email.recipient, subject: email.subject, body: email.body });
        await client.query("UPDATE outbox_emails SET sent_at = $2, attempts = attempts + 1 WHERE id = $1", [email.id, now()]);
      } catch (error) {
        await client.query("UPDATE outbox_emails SET attempts = attempts + 1 WHERE id = $1", [email.id]);
        console.error(`email ${email.id} not delivered yet`, error instanceof Error ? error.message : error);
      }
    }
    await client.query("COMMIT");
    client.release();
  } catch (error) {
    client.release(true);
    throw error;
  }
}

export function startDispatcher(): void {
  setInterval(kickDispatcher, 1_000).unref();
  kickDispatcher();
}

/** Links in emails point at APP_PUBLIC_URL, or http://localhost:<port>. */
export function appLink(path: string): string {
  return `${config.publicOrigin}${path}`;
}
