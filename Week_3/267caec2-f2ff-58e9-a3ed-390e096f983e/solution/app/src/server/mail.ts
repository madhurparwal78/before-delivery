import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { PROVIDER_TIMEOUT_MS, config } from "./config.js";
import { type Db, pool } from "./db.js";

// Plain-text email over SMTP to Mailpit (brief: Services, Mailpit), with a Postgres queue for every email
// that is not the receipt.

export class MailUnavailable extends Error {}

export interface Message {
  to: string;
  subject: string;
  body: string;
}

/** Wakes the background sender as soon as something is queued. */
let wake: (() => void) | null = null;

const fromAddress = /<([^>]+)>/.exec(config.smtp.from)?.[1] ?? config.smtp.from.trim();

/** RFC 2047 encoded words, split on character boundaries so each stays under 75 characters. */
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

function render(message: Message): string {
  const body = Buffer.from(message.body.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: ${message.to}`,
    `Subject: ${headerText(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${fromAddress.slice(fromAddress.indexOf("@") + 1)}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** An SMTP conversation held open at DATA, so the message can be written once its contents are known. */
export interface MailSession {
  send(message: Message): Promise<void>;
  abort(): void;
}

/** Opens a conversation for one recipient; resolves once the server is ready for the message data. */
export function openMail(to: string): Promise<MailSession> {
  const socket = new Socket();
  let buffer = "";
  let waiting: { code: number; resolve: () => void; reject: (error: MailUnavailable) => void } | null = null;
  let broken: MailUnavailable | null = null;
  const fail = (reason: string) => {
    broken = new MailUnavailable(reason);
    socket.destroy();
    waiting?.reject(broken);
    waiting = null;
  };
  const expect = (code: number, line?: string): Promise<void> => new Promise((resolve, reject) => {
    if (broken) return reject(broken);
    waiting = { code, resolve, reject };
    socket.setTimeout(PROVIDER_TIMEOUT_MS);
    if (line !== undefined) socket.write(`${line}\r\n`);
  });
  socket.on("timeout", () => fail("SMTP timed out"));
  socket.on("error", (error) => fail(error.message));
  socket.on("close", () => fail("SMTP connection closed"));
  socket.on("data", (data) => {
    buffer += data.toString("utf8");
    const lines = buffer.split("\r\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line[3] === "-") continue;
      const current = waiting;
      if (!current) return fail(`SMTP answered unasked: ${line}`);
      if (Number(line.slice(0, 3)) !== current.code) return fail(`SMTP answered ${line}`);
      waiting = null;
      socket.setTimeout(0);
      current.resolve();
    }
  });
  const ready = expect(220).then(async () => {
    await expect(250, "EHLO cutline-jury-desk");
    await expect(250, `MAIL FROM:<${fromAddress}>`);
    await expect(250, `RCPT TO:<${to}>`);
    await expect(354, "DATA");
  });
  socket.connect(config.smtp.port, config.smtp.host);
  return ready.then(() => ({
    async send(message: Message): Promise<void> {
      await expect(250, `${render({ ...message, to }).replace(/^\./gm, "..")}\r\n.`);
      socket.removeAllListeners("close");
      socket.end("QUIT\r\n");
    },
    abort(): void {
      socket.removeAllListeners("close");
      socket.destroy();
    },
  }), (error: unknown) => {
    socket.destroy();
    throw error;
  });
}

/** One SMTP conversation; resolves only once the server accepted the message. */
export async function sendMail(message: Message): Promise<void> {
  const session = await openMail(message.to);
  await session.send(message);
}

/** Queues an email in the caller's transaction; the sender delivers it once it is due. */
export async function queueMail(db: Db, kind: string, message: Message, dueAt: Date | null = null): Promise<void> {
  await db.query(
    `INSERT INTO emails (kind, recipient, subject, body, due_at, next_attempt_at)
     VALUES ($1, $2, $3, $4, coalesce($5, now()), coalesce($5, now()))`,
    [kind, message.to, message.subject, message.body, dueAt]);
  wake?.();
}

/** Records an email the request itself sent (the receipt). */
export async function recordSentMail(db: Db, kind: string, message: Message): Promise<void> {
  await db.query(
    "INSERT INTO emails (kind, recipient, subject, body, sent_at) VALUES ($1, $2, $3, $4, now())",
    [kind, message.to, message.subject, message.body]);
}

const RETRY_SECONDS = 5;

/** Delivers one due email; each is locked while sent so two instances never send it twice. */
async function deliverNext(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; recipient: string; subject: string; body: string }>(
      `SELECT id, recipient, subject, body FROM emails
       WHERE sent_at IS NULL AND next_attempt_at <= now()
       ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const row = rows[0];
    if (!row) {
      await client.query("COMMIT");
      return false;
    }
    try {
      await sendMail({ to: row.recipient, subject: row.subject, body: row.body });
      await client.query("UPDATE emails SET sent_at = now() WHERE id = $1", [row.id]);
    } catch {
      await client.query(`UPDATE emails SET next_attempt_at = now() + interval '${RETRY_SECONDS} seconds' WHERE id = $1`, [row.id]);
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** The background sender: polls every second, and at once when something is queued. */
export async function runMailSender(): Promise<never> {
  for (;;) {
    try {
      while (await deliverNext()) { /* drain everything due */ }
    } catch (error) {
      console.error(`mail sender: ${(error as Error).message}`);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
