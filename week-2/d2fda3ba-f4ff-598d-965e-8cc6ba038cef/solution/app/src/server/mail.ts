// Outbound mail: a minimal SMTP client, the outbox (emails wait there while SMTP is unreachable)
// and the three emails from Services. No email ever carries note content or a vault name.
import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.ts";
import { pool, type Queryable } from "./db.ts";
import { escapeHtml } from "../shared/render.ts";
import { formatWhen } from "../shared/time.ts";

const FROM_ADDRESS = "no-reply@cairn.example";
const FROM = `Cairn <${FROM_ADDRESS}>`;

interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function header(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function base64Lines(text: string): string {
  return Buffer.from(text).toString("base64").replace(/.{1,76}/g, "$&\r\n");
}

function mime(email: Email): string {
  const boundary = `cairn-${randomUUID()}`;
  return [
    `From: ${FROM}`, `To: ${email.to}`, `Subject: ${header(email.subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@cairn.example>`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(email.text),
    `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(email.html),
    `--${boundary}--`, "",
  ].join("\r\n");
}

/** One SMTP conversation: EHLO, MAIL, RCPT, DATA, QUIT. */
function smtpSend(email: Email): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(15000, () => socket.destroy(new Error("SMTP timeout")));
    const steps = [`EHLO cairn.example`, `MAIL FROM:<${FROM_ADDRESS}>`, `RCPT TO:<${email.to}>`, "DATA",
      `${mime(email).replace(/\r\n\./g, "\r\n..")}\r\n.`, "QUIT"];
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) {
          socket.destroy();
          reject(new Error(`SMTP refused: ${line}`));
          return;
        }
        const next = steps.shift();
        if (next === undefined) {
          socket.end();
          resolve();
          return;
        }
        socket.write(`${next}\r\n`);
      }
    });
    socket.on("error", reject);
  });
}

export async function enqueue(db: Queryable, email: Email): Promise<void> {
  await db.query("INSERT INTO email_outbox (to_address, subject, text_body, html_body) VALUES ($1, $2, $3, $4)",
    [email.to, email.subject, email.text, email.html]);
}

/** Sends every unsent email, claiming each row so several instances never send one twice. */
export async function flushOutbox(): Promise<void> {
  for (;;) {
    const { rows } = await pool.query<{ id: string; to_address: string; subject: string; text_body: string; html_body: string }>(
      `UPDATE email_outbox SET claimed_at = now(), attempts = attempts + 1
       WHERE id = (SELECT id FROM email_outbox WHERE sent_at IS NULL AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes')
                   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING id, to_address, subject, text_body, html_body`);
    if (rows.length === 0) return;
    const row = rows[0];
    try {
      await smtpSend({ to: row.to_address, subject: row.subject, text: row.text_body, html: row.html_body });
      await pool.query("UPDATE email_outbox SET sent_at = now() WHERE id = $1", [row.id]);
    } catch (error) {
      await pool.query("UPDATE email_outbox SET claimed_at = NULL WHERE id = $1", [row.id]);
      console.error("SMTP unavailable, email kept in the outbox:", (error as Error).message);
      return;
    }
  }
}

export function sendSoon(): void {
  flushOutbox().catch((error: Error) => console.error("outbox flush failed:", error.message));
}

function page(paragraphs: string[], link: string): string {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  return `<!doctype html><html><body style="font-family:sans-serif;color:#1a1e24">${body}<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p></body></html>`;
}

export function approvalEmail(to: string, deviceName: string, signedInAt: Date, expiresAt: Date, timeZone: string, token: string): Email {
  const link = `${config.publicUrl}/devices/approve/${token}`;
  const lines = [
    `A new device asked to join your Cairn account: ${deviceName}.`,
    `It signed in on ${formatWhen(signedInAt.toISOString(), timeZone)}.`,
    `If this was you, approve it with the link below. The link works once and expires on ${formatWhen(expiresAt.toISOString(), timeZone)}.`,
    "If it wasn't you, ignore this email; the device stays blocked from your vaults.",
  ];
  return { to, subject: "Approve a new Cairn device", text: `${lines.join("\n\n")}\n\n${link}\n`, html: page(lines, link) };
}

export function inviteEmail(to: string, inviter: string, expiresAt: Date, timeZone: string, token: string): Email {
  const link = `${config.publicUrl}/invites/${token}`;
  const lines = [
    `${inviter} invited you to co-edit a shared Cairn vault.`,
    `Accept with the link below while signed in with this email address. It works once and expires on ${formatWhen(expiresAt.toISOString(), timeZone)}.`,
    `${inviter} will share the vault passphrase with you separately; Cairn never sends it.`,
  ];
  return { to, subject: `${inviter} invited you to a shared Cairn vault`, text: `${lines.join("\n\n")}\n\n${link}\n`, html: page(lines, link) };
}

export function publishWarningEmail(to: string, takedownAt: Date, timeZone: string, slugs: string[]): Email {
  const when = formatWhen(takedownAt.toISOString(), timeZone);
  const addresses = slugs.map((slug) => `${config.publicUrl}/d/${slug}/`);
  const lines = [
    `Your Publish add-on has ended. On ${when} these dossiers go offline and every published page is removed:`,
    ...addresses,
    "Add Publish again before then to keep them online.",
  ];
  return {
    to, subject: `Cairn Publish: your dossiers go offline on ${when}`, text: `${lines.join("\n\n")}\n`,
    html: `<!doctype html><html><body style="font-family:sans-serif;color:#1a1e24">${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}</body></html>`,
  };
}
