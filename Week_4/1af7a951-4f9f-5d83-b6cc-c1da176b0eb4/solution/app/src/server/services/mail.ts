import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "../config.js";
import { pool, transaction } from "../db.js";
import { fail } from "../http.js";
import { formatPrice } from "../../shared/money.js";
import { wakeAlarm } from "../domain/time.js";

// Plain SMTP without authentication (the brief's mail server); Mailpit shows what was accepted.

const TIMEOUT_MS = 10_000;
const RECEIPT_RETRY_MS = 30_000;

class SmtpSession {
  private buffer = "";
  private waiting: ((reply: string) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (error) => this.failure?.(error));
    socket.on("close", () => this.failure?.(new Error("connection closed")));
  }

  private flush(): void {
    const lines = this.buffer.split("\r\n");
    const last = lines.findIndex((line) => /^\d{3} /.test(line));
    if (last === -1 || !this.waiting) return;
    const reply = lines.slice(0, last + 1).join("\n");
    this.buffer = lines.slice(last + 1).join("\r\n");
    const resolve = this.waiting;
    this.waiting = null;
    resolve(reply);
  }

  reply(expected: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.failure = reject;
      this.waiting = (reply) => ((reply.split("\n").pop() ?? "").startsWith(expected) ? resolve() : reject(new Error(reply)));
      this.flush();
    });
  }

  async command(line: string, expected: string): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.reply(expected);
  }
}

/** A header value as is when it is printable ASCII, otherwise as RFC 2047 encoded words of whole characters, folded. */
function header(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (Buffer.byteLength(chunk + character) > 42) {
      words.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join("\r\n ");
}

/** Sends one plain-text message; any refusal, timeout or error is the mail outage. */
export async function sendMail(to: string, subject: string, lines: string[]): Promise<void> {
  const socket = connect({ host: config.mail.host, port: config.mail.port });
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout")));
  const smtp = new SmtpSession(socket);
  const domain = config.mail.domain;
  const message = [
    `From: ${config.mail.from}`,
    `To: <${to}>`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    ...lines,
  ]
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
  try {
    await smtp.reply("220");
    await smtp.command(`EHLO ${domain}`, "250");
    await smtp.command(`MAIL FROM:<${config.mail.fromAddress}>`, "250");
    await smtp.command(`RCPT TO:<${to}>`, "250");
    await smtp.command("DATA", "354");
    await smtp.command(`${message}\r\n.`, "250");
    await smtp.command("QUIT", "221").catch(() => undefined);
  } catch {
    throw fail(503, "mail_unavailable");
  } finally {
    socket.destroy();
  }
}

interface ReceiptRow {
  email: string;
  cohort_name: string;
  first_night: string;
  bedtime: string;
  amount_paid_cents: number;
  id: string;
  receipt_access_code: string;
}

/**
 * Sends a confirmed enrolment's receipt if it is still pending. The row stays locked while sending,
 * so several server processes never send the same receipt twice. A mail outage leaves it pending.
 */
export async function deliverReceipt(enrollmentId: string): Promise<void> {
  await transaction(async (client) => {
    const found = await client.query<ReceiptRow>(
      `SELECT e.id, e.email, c.name AS cohort_name, e.first_night, e.bedtime, e.amount_paid_cents, e.receipt_access_code
         FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
        WHERE e.id = $1 AND e.receipt_status = 'pending'
        FOR UPDATE OF e SKIP LOCKED`,
      [enrollmentId],
    );
    const receipt = found.rows[0];
    if (!receipt) return;
    try {
      await sendMail(receipt.email, `Your Lanternfish seat in ${receipt.cohort_name} is confirmed`, [
        `Cohort: ${receipt.cohort_name}`,
        `First night: ${receipt.first_night}`,
        `Bedtime: ${receipt.bedtime}`,
        `Wake alarm: ${wakeAlarm(receipt.bedtime)}`,
        `Amount paid: ${formatPrice(receipt.amount_paid_cents)}`,
        `Enrollment: ${receipt.id}`,
        `Access code: ${receipt.receipt_access_code}`,
      ]);
    } catch {
      return;
    }
    await client.query("UPDATE enrollments SET receipt_status = 'sent', receipt_access_code = NULL WHERE id = $1", [receipt.id]);
  });
}

/** Retries pending receipts every 30 seconds while the server runs. */
export function retryPendingReceipts(): void {
  setInterval(() => {
    void (async () => {
      const pending = await pool.query<{ id: string }>("SELECT id FROM enrollments WHERE receipt_status = 'pending'");
      for (const { id } of pending.rows) await deliverReceipt(id);
    })().catch((error: unknown) => console.error("receipt retry failed:", error));
  }, RECEIPT_RETRY_MS);
}
