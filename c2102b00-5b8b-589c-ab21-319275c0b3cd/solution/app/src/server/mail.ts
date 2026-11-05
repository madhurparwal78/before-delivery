// Outgoing mail: queued in the database inside the transaction that causes it, delivered over
// SMTP by the process whose mail endpoint queued it, retried every MAIL_RETRY_SECONDS.
import { connect, type Socket } from "node:net";
import { config, mailEndpoint } from "./config.js";
import { all, nowSeconds, one, run, transaction } from "./db.js";

const LEASE_SECONDS = 60;
const SMTP_TIMEOUT_MS = 10_000;

interface Letter {
  kind: "receipt" | "short";
  cycleId: string;
  household: string;
  recipient: string;
  messageId: string;
  subject: string;
  body: string;
}

/** Queues a message for this process's mail endpoint; call inside the causing transaction. */
export function queueMail(letter: Letter): void {
  run(
    `INSERT INTO mail (kind, cycle_id, household_code, recipient, message_id, subject, body, endpoint, status,
     failed_attempts, lease_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 0)`,
    letter.kind, letter.cycleId, letter.household, letter.recipient, letter.messageId, letter.subject, letter.body,
    mailEndpoint,
  );
}

// ---- Headers -----------------------------------------------------------------------------------

/** Strips anything that could end a header line. */
function oneLine(text: string): string {
  return text.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ");
}

/** RFC 2047 encoded words, never splitting a character between two words. */
function encodeHeader(text: string): string {
  const clean = oneLine(text);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  for (const char of clean) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}

function address(text: string): string {
  const match = /<([^<>\s]+)>/.exec(text);
  return oneLine(match ? match[1]! : text).trim();
}

function message(m: { recipient: string; message_id: string; subject: string; body: string }): string {
  const body = Buffer.from(m.body.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${oneLine(config.mail.from)}`,
    `To: ${address(m.recipient)}`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Message-ID: <${oneLine(m.message_id)}>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

// ---- SMTP --------------------------------------------------------------------------------------

class SmtpSession {
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (data: string) => {
      this.buffer += data;
      this.drain();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("connection closed")));
    socket.setTimeout(SMTP_TIMEOUT_MS, () => this.fail(new Error("timed out")));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.socket.destroy();
    this.drain();
  }

  private drain(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split("\r\n");
    const done = lines.findIndex((l) => /^\d{3} /.test(l));
    if (done >= 0) {
      this.buffer = lines.slice(done + 1).join("\r\n");
      const resolve = this.waiting;
      this.waiting = null;
      resolve(lines[done]!);
    } else if (this.failure) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(`000 ${this.failure.message}`);
    }
  }

  reply(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
  }

  async expect(command: string | null, code: string): Promise<void> {
    if (command !== null) this.socket.write(`${command}\r\n`);
    const line = await this.reply();
    if (!line.startsWith(code)) throw new Error(`SMTP refused: ${line}`);
  }

  close(): void {
    this.socket.end();
  }
}

async function deliver(m: { recipient: string; message_id: string; subject: string; body: string }): Promise<void> {
  const session = new SmtpSession(connect({ host: config.mail.host, port: config.mail.port }));
  try {
    await session.expect(null, "220");
    await session.expect("EHLO tally-split", "250");
    await session.expect(`MAIL FROM:<${address(config.mail.from)}>`, "250");
    await session.expect(`RCPT TO:<${address(m.recipient)}>`, "25");
    await session.expect("DATA", "354");
    const data = message(m).replace(/^\./gm, "..");
    await session.expect(`${data}\r\n.`, "250");
    await session.expect("QUIT", "221").catch(() => undefined);
  } finally {
    session.close();
  }
}

// ---- Delivery loop -----------------------------------------------------------------------------

interface Queued {
  id: number;
  recipient: string;
  message_id: string;
  subject: string;
  body: string;
}

/** Leases one queued message so no other process sharing the database sends it at the same time. */
function lease(id: number): Queued | undefined {
  return transaction(() => {
    const now = nowSeconds();
    const claimed = run(
      "UPDATE mail SET lease_until = ? WHERE id = ? AND status = 'queued' AND endpoint = ? AND lease_until <= ?",
      now + LEASE_SECONDS, id, mailEndpoint, now,
    );
    return claimed.changes ? one<Queued>("SELECT * FROM mail WHERE id = ?", id) : undefined;
  });
}

let running: Promise<void> | null = null;
let again = false;

async function deliverQueued(): Promise<void> {
  const ids = all<{ id: number }>(
    "SELECT id FROM mail WHERE endpoint = ? AND status = 'queued' AND lease_until <= ? ORDER BY id",
    mailEndpoint, nowSeconds(),
  );
  for (const { id } of ids) {
    const m = lease(id);
    if (!m) continue;
    try {
      await deliver(m);
      transaction(() => run("UPDATE mail SET status = 'sent', lease_until = 0 WHERE id = ?", id));
    } catch {
      // The next attempt waits for the retry timer.
      transaction(() =>
        run(
          "UPDATE mail SET failed_attempts = failed_attempts + 1, lease_until = ? WHERE id = ?",
          nowSeconds() + config.mail.retrySeconds - 1, id,
        ),
      );
    }
  }
}

/** Attempts every queued message this process owns; called after commits and on the retry timer. */
export function sendQueuedMail(): void {
  if (running) {
    again = true;
    return;
  }
  running = deliverQueued()
    .catch((error: unknown) => console.error("mail delivery stopped:", error instanceof Error ? error.message : error))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        sendQueuedMail();
      }
    });
}

export function startMailRetries(): void {
  setInterval(sendQueuedMail, config.mail.retrySeconds * 1000).unref();
  sendQueuedMail();
}
