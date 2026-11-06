// Mail: messages wait in a PostgreSQL outbox and are delivered to Mailpit over SMTP exactly once.
import { connect, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { rows, transaction, type Db } from "../db.js";

interface Mail { to: string[]; subject: string; body: string; fromName?: string }

const sender = (() => {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(config.mailFrom);
  return match ? { name: match[1].replace(/^"|"$/g, ""), address: match[2] } : { name: "", address: config.mailFrom.trim() };
})();


/** Queues a message in the caller's transaction, so it is sent only if the work it reports commits. */
export async function enqueueMail(db: Db, mail: Mail): Promise<void> {
  const to = [...new Set(mail.to.map((a) => a.toLowerCase()))];
  await db.query("INSERT INTO mail_outbox (recipients, from_name, subject, body, created_at) VALUES ($1, $2, $3, $4, now())",
    [JSON.stringify(to), mail.fromName ?? sender.name, mail.subject, mail.body]);
}

// Header-safe text: control characters (CR and LF included) are removed; non-ASCII is encoded.
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/g;
const clean = (text: string) => text.replace(CONTROL, "");
const ascii = (text: string) => /^[\x20-\x7e]*$/.test(text);

function encodedWords(text: string): string {
  const words: string[] = [];
  let chunk = "";
  for (const char of text) {
    if (Buffer.byteLength(chunk + char) > 45) { words.push(chunk); chunk = ""; }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}

function displayName(name: string): string {
  const safe = clean(name);
  if (!ascii(safe)) return encodedWords(safe);
  return `"${safe.replace(/(["\\])/g, "\\$1")}"`;
}

function headerText(text: string): string {
  const safe = clean(text);
  return ascii(safe) ? safe : encodedWords(safe);
}

function message(to: string[], fromName: string, subject: string, body: string): string {
  const encoded = Buffer.from(body.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${displayName(fromName)} <${sender.address}>`,
    `To: ${to.join(", ")}`,
    `Subject: ${headerText(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${sender.address.split("@")[1] ?? "localhost"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
  ].join("\r\n");
}

/** A minimal SMTP conversation: EHLO, MAIL FROM, RCPT TO for each recipient, DATA. */
function smtpSend(to: string[], data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP timeout")));
    const steps = [
      `EHLO orrery-studio`, `MAIL FROM:<${sender.address}>`, ...to.map((a) => `RCPT TO:<${a}>`), "DATA", `${data}\r\n.`, "QUIT",
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
        if (code >= 400) { socket.destroy(new Error(`SMTP ${line}`)); return; }
        step += 1;
        if (step < steps.length) socket.write(`${steps[step]}\r\n`);
        else { socket.end(); resolve(); }
      }
    });
    socket.on("error", reject);
    socket.on("close", () => (step >= steps.length - 1 ? resolve() : reject(new Error("SMTP connection closed early"))));
  });
}

/** Sends queued mail; a message that fails stays queued and is retried on the next pass. */
export async function deliverQueuedMail(): Promise<void> {
  await transaction(async (client) => {
    const queued = await rows<{ id: string; recipients: string[]; from_name: string; subject: string; body: string }>(client,
      "SELECT id, recipients, from_name, subject, body FROM mail_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED");
    for (const mail of queued) {
      try {
        await smtpSend(mail.recipients, message(mail.recipients, mail.from_name, mail.subject, mail.body));
      } catch (error) {
        console.error("mail delivery deferred:", error instanceof Error ? error.message : error);
        return;
      }
      await client.query("UPDATE mail_outbox SET sent_at = now() WHERE id = $1", [mail.id]);
    }
  });
}
