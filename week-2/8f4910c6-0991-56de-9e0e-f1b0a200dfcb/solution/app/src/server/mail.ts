// Outgoing mail: every message is written to the PostgreSQL outbox in the caller's transaction, and any
// app copy delivers pending rows over SMTP, each exactly once (rows are claimed with SKIP LOCKED).

import { connect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { exec, pool, rows, type Db } from "./db.js";
import { singleLine } from "../shared/text.js";

export interface Attachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  attachments?: Attachment[];
  /** Talent the message mentions, so erasure can delete it while unsent. */
  talentIds?: string[];
}

export async function enqueue(db: Db, mail: Mail): Promise<void> {
  await exec(
    db,
    `INSERT INTO outbox (to_address, subject, text_body, attachments, talent_ids, created_at, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())`,
    [singleLine(mail.to).trim(), singleLine(mail.subject), mail.text, JSON.stringify(mail.attachments ?? []),
      mail.talentIds ?? []],
  );
}

/** A link into the app, absolute from APP_BASE_URL or the local port. */
export function appLink(path: string): string {
  return `${config.baseUrl}${path}`;
}

function addressOf(header: string): string {
  const match = /<([^>]+)>/.exec(header);
  return (match ? match[1] : header).trim();
}

function encodeHeader(value: string): string {
  const clean = singleLine(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  for (const char of clean) {
    if (Buffer.byteLength(chunk + char) > 42) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join("\r\n ");
}

function base64Lines(content: string): string {
  return (Buffer.from(content).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function render(mail: { to: string; subject: string; text: string; attachments: Attachment[] }): string {
  const boundary = `rb-${randomBytes(12).toString("hex")}`;
  const headers = [
    `From: ${encodeHeader(config.smtp.from)}`,
    `To: ${encodeHeader(mail.to)}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@rungboard.vesperrowe.example>`,
    "MIME-Version: 1.0",
  ];
  const textPart = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "",
    base64Lines(mail.text)];
  if (!mail.attachments.length) return [...headers, ...textPart].join("\r\n");
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPart,
  ];
  for (const attachment of mail.attachments) {
    const name = singleLine(attachment.filename).replace(/"/g, "");
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(attachment.content),
    );
  }
  parts.push(`--${boundary}--`);
  return parts.join("\r\n");
}

/** A minimal SMTP conversation with the configured relay (no auth, no TLS: Mailpit is the sink). */
function smtpSend(to: string, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(config.smtp.port, config.smtp.host);
    socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP timeout")));
    const steps = [
      { expect: 220, send: "EHLO rungboard.vesperrowe.example" },
      { expect: 250, send: `MAIL FROM:<${addressOf(config.smtp.from)}>` },
      { expect: 250, send: `RCPT TO:<${addressOf(to)}>` },
      { expect: 250, send: "DATA" },
      { expect: 354, send: `${message.replace(/\r\n\./g, "\r\n..")}\r\n.` },
      { expect: 250, send: "QUIT" },
    ];
    let buffer = "";
    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line[3] === "-") continue;
        const step = steps.shift();
        if (!step) return;
        if (Number(line.slice(0, 3)) !== step.expect) {
          socket.destroy();
          reject(new Error(`SMTP: ${line}`));
          return;
        }
        socket.write(`${step.send}\r\n`);
        if (!steps.length) {
          socket.end();
          resolve();
        }
      }
    });
    socket.on("error", reject);
  });
}

interface OutboxRow {
  id: number;
  to_address: string;
  subject: string;
  text_body: string;
  attachments: Attachment[];
  attempts: number;
}

/** Delivers a batch of pending mail; a failed send is retried with back-off. */
export async function deliverPending(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pending = await rows<OutboxRow>(
      client,
      `SELECT id, to_address, subject, text_body, attachments, attempts FROM outbox
        WHERE sent_at IS NULL AND next_attempt_at <= now() ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`,
    );
    for (const row of pending) {
      try {
        await smtpSend(row.to_address, render({ to: row.to_address, subject: row.subject, text: row.text_body,
          attachments: row.attachments }));
        await exec(client, "UPDATE outbox SET sent_at = now() WHERE id = $1", [row.id]);
      } catch (error) {
        console.error(`mail ${row.id} not delivered yet:`, (error as Error).message);
        await exec(client, `UPDATE outbox SET attempts = attempts + 1,
          next_attempt_at = now() + make_interval(secs => least(60, 2 ^ attempts)) WHERE id = $1`, [row.id]);
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
