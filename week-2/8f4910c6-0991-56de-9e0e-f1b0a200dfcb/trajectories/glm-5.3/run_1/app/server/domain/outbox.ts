import net from "node:net";
import { config } from "../config.js";
import { query, one } from "../db.js";
import { shortId } from "../passwords.js";

/** The PostgreSQL outbox plus a small SMTP client for Mailpit. */

const CRLF = "\r\n";

export async function queueEmail(input: { to: string; subject: string; body: string; contentType?: string; attachmentName?: string; attachmentContent?: string }): Promise<string> {
  const id = shortId("mail");
  await query(
    `INSERT INTO mail_outbox (id, to_address, subject, body, content_type, attachment_name, attachment_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.to, input.subject, input.body, input.contentType || "text/plain", input.attachmentName || null, input.attachmentContent || null]
  );
  return id;
}

/** Deletes every unsent email mentioning the given text (used by erasure). */
export async function deleteUnsentMentioning(text: string): Promise<void> {
  await query(`DELETE FROM mail_outbox WHERE sent_at IS NULL AND (to_address = $1 OR subject ILIKE $2 OR body ILIKE $2)`, [text, `%${text}%`]);
}

interface SmtpStep {
  send: string;
  expect: string;
}

/** A line-based SMTP conversation, one response at a time. */
function smtpSend(to: string, subject: string, body: string, contentType: string, from: string, attachmentName: string, attachmentContent: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000);
    let buffer = "";
    let expectCode = "220";
    let stepIndex = 0;
    let settled = false;
    const fromAddress = extractAddress(from);
    const toAddress = extractAddress(to);
    const steps: SmtpStep[] = [
      { send: `EHLO rungboard.local`, expect: "250" },
      { send: `MAIL FROM:<${fromAddress}>`, expect: "250" },
      { send: `RCPT TO:<${toAddress}>`, expect: "250" },
      { send: `DATA`, expect: "354" },
    ];
    let quitSent = false;

    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.on("timeout", () => finish(new Error("SMTP timeout")));
    socket.on("error", (err) => finish(err));
    socket.on("close", () => {
      if (quitSent) finish(null);
      else finish(new Error("SMTP connection closed early"));
    });

    socket.on("data", (chunk) => {
      if (settled) return;
      buffer += chunk.toString("utf8");
      // A response is complete when its last line has a space after the code.
      while (buffer.includes(CRLF)) {
        const lineEnd = buffer.indexOf(CRLF);
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + CRLF.length);
        if (line.length < 3) continue;
        const isFinal = line.length === 3 || line[3] === " ";
        if (!isFinal) continue;
        const code = line.slice(0, 3);
        if (code !== expectCode) {
          finish(new Error(`SMTP expected ${expectCode} got ${line}`));
          return;
        }
        if (expectCode === "354") {
          const message = buildMessage(to, subject, body, contentType, from, attachmentName, attachmentContent);
          socket.write(message);
          expectCode = "250";
          return;
        }
        if (stepIndex < steps.length) {
          const step = steps[stepIndex];
          stepIndex += 1;
          expectCode = step.expect;
          socket.write(step.send + CRLF);
          return;
        }
        socket.write(`QUIT${CRLF}`);
        quitSent = true;
        socket.end();
        return;
      }
    });
  });
}

function buildMessage(to: string, subject: string, body: string, contentType: string, from: string, attachmentName: string, attachmentContent: string): string {
  const headers: string[] = [];
  headers.push(`From: ${sanitizeHeader(from)}`);
  headers.push(`To: ${sanitizeHeader(to)}`);
  headers.push(`Subject: =?utf-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`);
  headers.push("MIME-Version: 1.0");
  const boundary = `----=_rungboard_${shortId("b")}`;
  if (attachmentName) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    headers.push("");
    headers.push(`--${boundary}`);
    headers.push(`Content-Type: ${contentType}; charset=utf-8`);
    headers.push("Content-Transfer-Encoding: base64");
    headers.push("");
    headers.push(...base64Lines(body));
    headers.push("");
    headers.push(`--${boundary}`);
    headers.push(`Content-Type: text/calendar; charset=utf-8; name="${attachmentName}"`);
    headers.push("Content-Transfer-Encoding: base64");
    headers.push(`Content-Disposition: attachment; filename="${attachmentName}"`);
    headers.push("");
    headers.push(...base64Lines(attachmentContent));
    headers.push("");
    headers.push(`--${boundary}--`);
  } else {
    headers.push(`Content-Type: ${contentType}; charset=utf-8`);
    headers.push("Content-Transfer-Encoding: base64");
    headers.push("");
    headers.push(...base64Lines(body));
  }
  return headers.join(CRLF) + CRLF + "." + CRLF;
}

function extractAddress(header: string): string {
  const m = /<([^>]+)>/.exec(header);
  return m ? m[1] : header.trim();
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\t]/g, " ");
}

function base64Lines(text: string): string[] {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.length ? lines : [""];
}

/** Claims and sends pending mail. Safe across any number of app copies. */
export async function deliverPendingMail(): Promise<void> {
  const rows = await query<{ id: string; to_address: string; subject: string; body: string; content_type: string; attachment_name: string | null; attachment_content: string | null }>(
    `SELECT id, to_address, subject, body, content_type, attachment_name, attachment_content
     FROM mail_outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 25`
  );
  for (const row of rows) {
    const attempts = await one<{ attempts: number }>(`SELECT attempts FROM mail_outbox WHERE id = $1`, [row.id]);
    const claimed = await one<{ id: string }>(
      `UPDATE mail_outbox SET attempts = attempts + 1 WHERE id = $1 AND sent_at IS NULL AND attempts = $2 RETURNING id`,
      [row.id, attempts?.attempts ?? 0]
    );
    if (!claimed) continue;
    try {
      await smtpSend(row.to_address, row.subject, row.body, row.content_type, config.smtp.mailFrom, row.attachment_name ?? "", row.attachment_content ?? "");
      await query(`UPDATE mail_outbox SET sent_at = now() WHERE id = $1`, [row.id]);
    } catch {
      await query(`UPDATE mail_outbox SET attempts = 0 WHERE id = $1`, [row.id]);
    }
  }
}
