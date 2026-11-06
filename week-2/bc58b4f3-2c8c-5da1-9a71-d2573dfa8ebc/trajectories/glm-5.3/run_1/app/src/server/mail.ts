import { createConnection, Socket } from "node:net";
import { Pool } from "pg";
import { Config } from "./config";

interface MailJob {
  id: number;
  to_email: string;
  subject: string;
  body: string;
}

/** Send one email over plain SMTP; resolves false when SMTP cannot be reached. */
export async function smtpSend(config: Config, to: string, subject: string, body: string, timeoutMs = 5000): Promise<boolean> {
  let sock: Socket;
  try {
    sock = createConnection({ host: config.smtpHost, port: config.smtpPort });
    await new Promise<void>((resolve, reject) => {
      sock.once("connect", resolve);
      sock.once("error", reject);
      setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
  } catch {
    return false;
  }
  try {
    const id = (s: string) => new Promise<string>((resolve, reject) => {
      let buf = "";
      const onData = (d: Buffer) => {
        buf += d.toString("utf8");
        if (/\r?\n$/.test(buf)) {
          sock.off("data", onData);
          sock.off("error", onErr);
          resolve(buf);
        }
      };
      const onErr = (e: Error) => { sock.off("data", onData); reject(e); };
      sock.on("data", onData);
      sock.once("error", onErr);
      if (s) sock.write(s + "\r\n");
    });
    const ehloHost = "teamseat.local";
    await id(""); // greeting
    await id(`EHLO ${ehloHost}`);
    await id(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`);
    await id(`RCPT TO:<${to}>`);
    await id("DATA");
    // Body may contain dots; escape leading dots per RFC 5321.
    const safeBody = body.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
    const message = [
      `From: ${config.mailFrom}`,
      `To: ${to}`,
      `Subject: ${mimeEncode(subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
    ].join("\r\n");
    const payload = message + "\r\n" + Buffer.from(safeBody, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n") + "\r\n.\r\n";
    await new Promise<void>((resolve) => { sock.write(payload, () => resolve()); });
    const finalRes = await id("");
    await id("QUIT");
    return finalRes.startsWith("2");
  } catch {
    return false;
  } finally {
    sock.destroy();
  }
  function mimeEncode(text: string): string {
    if (/^[\x20-\x7e]*$/.test(text)) return text;
    return `=?utf-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
  }
}

function envelopeAddress(fromHeader: string): string {
  const m = /<([^>]+)>/.exec(fromHeader);
  return m ? m[1] : fromHeader;
}

export async function queueEmail(db: Pool, to: string, subject: string, body: string): Promise<void> {
  await db.query(
    `INSERT INTO outbox_emails (to_email, subject, body) VALUES ($1,$2,$3)`,
    [to, subject, body],
  );
}

/** Try to send every unsent email; called from the background loop. */
export async function flushOutbox(db: Pool, config: Config): Promise<void> {
  const res = await db.query(
    `SELECT id, to_email, subject, body FROM outbox_emails WHERE sent_at IS NULL ORDER BY id LIMIT 50`,
  );
  const jobs = res.rows as MailJob[];
  for (const job of jobs) {
    const ok = await smtpSend(config, job.to_email, job.subject, job.body);
    if (ok) {
      await db.query(`UPDATE outbox_emails SET sent_at = now(), last_error = NULL WHERE id = $1`, [job.id]);
    } else {
      await db.query(`UPDATE outbox_emails SET attempts = attempts + 1 WHERE id = $1`, [job.id]);
      return; // SMTP down; try again on the next sweep
    }
  }
}

