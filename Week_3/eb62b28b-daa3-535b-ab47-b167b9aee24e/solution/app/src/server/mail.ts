// The pending-mail list in Postgres and its SMTP delivery. A row leaves the list once the server accepts it.

import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config";
import { pool, rows, type Db } from "./db";

interface PendingMail {
  seq: string;
  to_address: string;
  subject: string;
  body: string;
}

export async function enqueueMail(db: Db, memberId: string | null, to: string, subject: string, body: string): Promise<void> {
  await db.query("INSERT INTO pending_mail (member_id, to_address, subject, body) VALUES ($1, $2, $3, $4)", [memberId, to, subject, body]);
}

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from.trim();
}

function formatMessage(mail: PendingMail): string {
  const stuffed = mail.body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return [
    `From: ${config.smtp.from}`,
    `To: ${mail.to_address}`,
    `Subject: ${mail.subject}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${envelopeAddress(config.smtp.from).split("@").at(-1)}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    stuffed,
    ".",
    "",
  ].join("\r\n");
}

// One SMTP conversation: each step waits for the expected reply code.
function deliver(mail: PendingMail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port, timeout: 10000 });
    const steps: { expect: string; send: string }[] = [
      { expect: "220", send: "EHLO ocotillo-member-desk\r\n" },
      { expect: "250", send: `MAIL FROM:<${envelopeAddress(config.smtp.from)}>\r\n` },
      { expect: "250", send: `RCPT TO:<${mail.to_address}>\r\n` },
      { expect: "250", send: "DATA\r\n" },
      { expect: "354", send: formatMessage(mail) },
      { expect: "250", send: "QUIT\r\n" },
    ];
    let buffered = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      if (!/(^|\r\n)\d{3} [^\r\n]*\r\n$/.test(buffered)) return;
      const lastLine = buffered.trimEnd().split("\r\n").at(-1) ?? "";
      buffered = "";
      const step = steps.shift();
      if (!step) {
        socket.end();
        resolve();
        return;
      }
      if (!lastLine.startsWith(step.expect)) {
        socket.destroy();
        reject(new Error(`SMTP answered ${lastLine}`));
        return;
      }
      socket.write(step.send);
    });
    socket.on("timeout", () => socket.destroy(new Error("SMTP timed out")));
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("SMTP closed the connection")));
  });
}

export async function deliverPendingMail(): Promise<void> {
  const waiting = await rows<PendingMail>(pool, "SELECT seq, to_address, subject, body FROM pending_mail ORDER BY seq LIMIT 50");
  for (const mail of waiting) {
    await deliver(mail);
    await pool.query("DELETE FROM pending_mail WHERE seq = $1", [mail.seq]);
  }
}
