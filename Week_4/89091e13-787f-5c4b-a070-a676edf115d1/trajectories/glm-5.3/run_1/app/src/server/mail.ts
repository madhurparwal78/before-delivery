// Mail delivery. Every mail is written to the outbox in the same transaction as
// its event; a sender retries every 5 seconds until SMTP accepts it.

import { connect as netConnect, Socket } from "node:net";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { DbLike } from "./db.js";

export interface QueuedMail {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
}

/** Queues a mail in the caller's transaction so it commits with its event. */
export async function queueMail(
  db: DbLike,
  workspaceId: string | null,
  toEmail: string,
  subject: string,
  body: string,
): Promise<void> {
  await db.query(
    `INSERT INTO mail_outbox (id, workspace_id, to_email, subject, body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomBytes(12).toString("hex"), workspaceId, toEmail, subject, body, new Date()],
  );
}

/** Sends one mail over SMTP; resolves false when SMTP is unreachable. */
export async function sendMail(cfg: AppConfig, toEmail: string, subject: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: Socket = netConnect(cfg.smtpPort, cfg.smtpHost);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(5000, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("connect", () => {
      const steps: { expect: number; line: string }[] = [
        { expect: 220, line: "" },
        { expect: 250, line: `HELO fernsquare` },
        { expect: 250, line: `MAIL FROM:<${extractAddress(cfg.mailFrom)}>` },
        { expect: 250, line: `RCPT TO:<${toEmail}>` },
        { expect: 354, line: `DATA` },
      ];
      let stepIndex = 0;
      let dataMode = false;
      const sendNext = () => {
        if (stepIndex >= steps.length) return;
        const step = steps[stepIndex]!;
        if (step.line) socket.write(`${step.line}\r\n`);
      };
      socket.on("data", (buffer) => {
        const text = buffer.toString("utf8");
        if (dataMode) return;
        const code = Number.parseInt(text.slice(0, 3), 10);
        const step = steps[stepIndex];
        if (!step) return;
        if (code !== step.expect) {
          finish(false);
          return;
        }
        stepIndex++;
        if (stepIndex === steps.length) {
          const message = [
            `From: ${cfg.mailFrom}`,
            `To: ${toEmail}`,
            `Subject: ${subject}`,
            `Content-Type: text/plain; charset=utf-8`,
            ``,
            body,
          ].join("\r\n");
          socket.write(`${message}\r\n.\r\n`);
          dataMode = true;
          socket.once("data", (doneBuffer) => {
            const doneText = doneBuffer.toString("utf8");
            finish(doneText.startsWith("250"));
            socket.write(`QUIT\r\n`);
          });
          return;
        }
        sendNext();
      });
      sendNext();
    });
  });
}

function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match?.[1] ?? from;
}

/** Sends every unsent outbox mail, marking successes. Returns how many went out. */
export async function deliverOutbox(cfg: AppConfig, db: DbLike): Promise<number> {
  const rows = await db.many<QueuedMail & { workspace_id: string | null }>(
    `SELECT id, to_email AS "toEmail", subject, body FROM mail_outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 50`,
  );
  let sent = 0;
  for (const mail of rows) {
    const ok = await sendMail(cfg, mail.toEmail, mail.subject, mail.body);
    if (ok) {
      await db.query(`UPDATE mail_outbox SET sent_at = $1, attempts = attempts + 1 WHERE id = $2`, [
        new Date(),
        mail.id,
      ]);
      sent++;
    } else {
      await db.query(`UPDATE mail_outbox SET attempts = attempts + 1 WHERE id = $1`, [mail.id]);
    }
  }
  return sent;
}
