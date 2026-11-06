// Every email the product sends goes through the Postgres outbox to Mailpit over SMTP
// (SMTP_HOST:SMTP_PORT, from MAIL_FROM). Unsent messages are retried every 30 seconds.
import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import type pg from "pg";
import { config } from "./config.js";
import { query, pool, type Db } from "./db.js";

export async function ownersOf(db: Db, workspaceId: string): Promise<Array<{ email: string; name: string }>> {
  return query(db,
    `SELECT u.email, u.name FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = $1 AND m.role = 'owner' ORDER BY u.email`, [workspaceId]);
}

export async function enqueueMail(client: pg.PoolClient | pg.Pool, recipient: string, subject: string, body: string): Promise<void> {
  await client.query(
    "INSERT INTO mail_outbox (recipient, subject, body, created_at, next_attempt_at) VALUES ($1, $2, $3, now(), now())",
    [recipient, subject, body]);
}

const address = (value: string): string => /<([^>]+)>/.exec(value)?.[1] ?? value.trim();

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

function message(recipient: string, subject: string, body: string): string {
  const encoded = Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: ${recipient}`,
    `Subject: ${encodeHeader(subject)}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@farshore.test>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
  ].join("\r\n");
}

// A minimal SMTP conversation: EHLO, MAIL FROM, RCPT TO, DATA, QUIT.
function sendSmtp(recipient: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000, () => socket.destroy(new Error("smtp timeout")));
    const steps = [
      "EHLO farshore",
      `MAIL FROM:<${address(config.smtp.from)}>`,
      `RCPT TO:<${address(recipient)}>`,
      "DATA",
      `${data.replace(/^\./gm, "..")}\r\n.`,
      "QUIT",
    ];
    const expected = [220, 250, 250, 250, 354, 250, 221];
    let step = 0;
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      // A reply is complete when its last line has a space after the code.
      const lines = buffer.split("\r\n");
      const last = lines.slice(0, -1).reverse().find((l) => /^\d{3}[ -]/.test(l));
      if (!last || last[3] !== " ") return;
      buffer = "";
      const code = Number(last.slice(0, 3));
      if (code !== expected[step]) {
        socket.destroy();
        reject(new Error(`smtp answered ${last}`));
        return;
      }
      const next = steps[step];
      step += 1;
      if (next === undefined) {
        socket.end();
        resolve();
        return;
      }
      socket.write(`${next}\r\n`);
    });
    socket.on("error", reject);
  });
}

// Starts an outbox pass now; startMailWorker points it at the running worker.
export let wakeMail = (): void => undefined;

async function deliverOutbox(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const due = await query<{ id: number; recipient: string; subject: string; body: string }>(client,
      `SELECT id, recipient, subject, body FROM mail_outbox WHERE sent_at IS NULL AND next_attempt_at <= now()
       ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`);
    for (const mail of due) {
      try {
        await sendSmtp(mail.recipient, message(mail.recipient, mail.subject, mail.body));
        await client.query("UPDATE mail_outbox SET sent_at = now() WHERE id = $1", [mail.id]);
      } catch {
        await client.query("UPDATE mail_outbox SET next_attempt_at = now() + interval '30 seconds' WHERE id = $1", [mail.id]);
      }
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
  }
}

export function startMailWorker(): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await deliverOutbox();
    } finally {
      running = false;
    }
  };
  wakeMail = () => void tick();
  setInterval(() => void tick(), 1000).unref();
}
