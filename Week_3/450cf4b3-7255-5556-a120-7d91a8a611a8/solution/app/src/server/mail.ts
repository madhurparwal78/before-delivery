// Mail: every email is queued in Postgres inside the transaction of the action that caused it,
// then delivered by whichever process claims it, until the SMTP server acknowledges the message.

import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { db } from "./db.js";
import { col, only, type Queryable } from "./postgres.js";

const CLAIM_SECONDS = 25;
const RETRY_SECONDS = 20;
/** Marks this process's own failed sends, so a process that can't reach mail never starves one that can. */
const PROCESS_ID = randomUUID();
const SMTP_TIMEOUT_MS = 15_000;

interface Email {
  action: "booking_confirmed" | "booking_moved" | "pack_receipt" | "expiry_notice";
  recordId: string;
  /** The tenant's contact name, used as the To display name exactly. */
  toName: string;
  to: string;
  subject: string;
  lines: readonly string[];
}

/** Queues an email in the action's own transaction; returns the queued email's id. */
export async function queueEmail(tx: Queryable, email: Email): Promise<string> {
  const row = only(await tx.query(
    "INSERT INTO mail_queue (action, record_id, to_name, to_address, subject, body) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [email.action, email.recordId, email.toName, email.to, email.subject, email.lines.join("\r\n")],
  ));
  return col.text(row, "id");
}

const ENCODED_WORD_BYTES = 45;

/** RFC 2047 encoded words (each under 75 characters, split between characters) when the text is not plain ASCII. */
function headerText(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let chunk = "";
  for (const char of text) {
    if (Buffer.byteLength(chunk + char, "utf8") > ENCODED_WORD_BYTES) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`).join(" ");
}

/** One mailbox: the display name quoted (or encoded when non-ASCII), then the address in angle brackets. */
function mailbox(name: string, address: string): string {
  const display = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/[\\"]/g, "\\$&")}"` : headerText(name);
  return `${display} <${address}>`;
}

/** The bare address inside MAIL_FROM, for the SMTP envelope. */
function fromAddress(): string {
  return /<([^<>]+)>\s*$/.exec(config.mailFrom)?.[1] ?? config.mailFrom;
}

function message(id: string, toName: string, to: string, subject: string, body: string): string {
  const stuffed = body.split(/\r?\n/).map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
  return [
    `From: ${config.mailFrom}`,
    `To: ${mailbox(toName, to)}`,
    `Subject: ${headerText(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <queue-${id}@stationhouse.test>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    stuffed,
  ].join("\r\n");
}

/** One SMTP conversation; resolves only when the server answers the end of DATA with 250. */
function smtpSend(to: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    const steps = [`EHLO stationhouse.test`, `MAIL FROM:<${fromAddress()}>`, `RCPT TO:<${to}>`, "DATA", `${data}\r\n.`];
    const expected = [220, 250, 250, 250, 354, 250];
    let step = 0;
    let buffer = "";
    let settled = false;
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(SMTP_TIMEOUT_MS, () => finish(new Error("SMTP timed out")));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("SMTP connection closed before the message was accepted")));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line[3] === "-") continue;
        const code = Number(line.slice(0, 3));
        if (code !== expected[step]) {
          finish(new Error(`SMTP replied ${line}`));
          return;
        }
        if (step === 5) {
          finish(null);
          return;
        }
        socket.write(`${steps[step]}\r\n`);
        step++;
      }
    });
  });
}

/** Claims and sends queued emails one at a time; any process may deliver any queued email. */
async function deliverQueued(): Promise<void> {
  for (;;) {
    const [row] = await db.query(
      `UPDATE mail_queue SET claimed_until = now() + make_interval(secs => $1), attempts = attempts + 1
        WHERE id = (SELECT id FROM mail_queue
                     WHERE delivered_at IS NULL AND (claimed_until IS NULL OR claimed_until < now())
                       AND (failed_by IS DISTINCT FROM $2 OR failed_at < now() - make_interval(secs => $3))
                     ORDER BY queued_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, to_name, to_address, subject, body`,
      [CLAIM_SECONDS, PROCESS_ID, RETRY_SECONDS],
    );
    if (!row) return;
    const id = col.text(row, "id");
    try {
      const to = col.text(row, "to_address");
      await smtpSend(to, message(id, col.text(row, "to_name"), to, col.text(row, "subject"), col.text(row, "body")));
    } catch (error) {
      await db.query("UPDATE mail_queue SET claimed_until = NULL, failed_by = $2, failed_at = now(), last_error = $3 WHERE id = $1",
        [id, PROCESS_ID, String(error)]);
      continue;
    }
    await db.query("UPDATE mail_queue SET delivered_at = now(), claimed_until = NULL, last_error = NULL WHERE id = $1", [id]);
  }
}

let delivering: Promise<void> | null = null;

/** Starts a delivery pass unless this process is already running one. */
export function deliverSoon(): void {
  if (delivering) return;
  delivering = deliverQueued()
    .catch((error: unknown) => console.error("mail delivery pass failed:", error))
    .finally(() => {
      delivering = null;
    });
}
