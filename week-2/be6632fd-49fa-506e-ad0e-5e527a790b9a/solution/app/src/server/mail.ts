// Outbox and SMTP delivery to Mailpit. A queued row is marked delivered only after the server accepts DATA.
import net from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { type Db, nowSeconds, pool } from "./db";

interface Mail {
  toName: string | null;
  toEmail: string;
  subject: string;
  body: string;
}

export async function queueMail(db: Db, mail: Mail): Promise<void> {
  await db.query("INSERT INTO outbox (to_name, to_email, subject, body, queued_at) VALUES ($1, $2, $3, $4, $5)", [
    mail.toName,
    mail.toEmail,
    mail.subject,
    mail.body,
    nowSeconds(),
  ]);
  deliverSoon();
}

/** RFC 2047 encoded words, split on character boundaries so each word stays under 76 characters. */
function encodeWords(value: string): string {
  const words: string[] = [];
  let current = "";
  for (const ch of value) {
    if (Buffer.byteLength(current + ch) > 45) {
      words.push(current);
      current = "";
    }
    current += ch;
  }
  if (current) words.push(current);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}

function addressOf(mailbox: string): string {
  const m = /<([^>]+)>/.exec(mailbox);
  return (m ? m[1] : mailbox).trim();
}

function displayOf(mailbox: string): string {
  const m = /^(.*)<[^>]+>\s*$/.exec(mailbox);
  return m ? m[1].trim().replace(/^"|"$/g, "") : "";
}

function mailbox(name: string | null, email: string): string {
  return name ? `${encodeWords(name)} <${email}>` : `<${email}>`;
}

function message(mail: Mail): string {
  const from = addressOf(config.mailFrom);
  const body = Buffer.from(mail.body.replace(/\r?\n/g, "\r\n"))
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${mailbox(displayOf(config.mailFrom) || null, from)}`,
    `To: ${mailbox(mail.toName, mail.toEmail)}`,
    `Subject: ${encodeWords(mail.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${from.split("@")[1] ?? "hourline.example"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** One SMTP conversation; resolves only when the server accepted the message. */
function smtpSend(mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    const from = addressOf(config.mailFrom);
    const steps: Array<[string | null, number]> = [
      [null, 220],
      ["EHLO hourline.example", 250],
      [`MAIL FROM:<${from}>`, 250],
      [`RCPT TO:<${mail.toEmail}>`, 250],
      ["DATA", 354],
      [`${message(mail).replace(/\r\n\./g, "\r\n..")}\r\n.`, 250],
      ["QUIT", 221],
    ];
    let buffer = "";
    let index = 0;
    let accepted = false;
    socket.setTimeout(10_000, () => socket.destroy(new Error("smtp timeout")));
    socket.on("error", (error) => (accepted ? resolve() : reject(error)));
    socket.on("close", () => (accepted ? resolve() : reject(new Error("smtp closed"))));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code !== steps[index][1]) {
          socket.destroy();
          reject(new Error(`smtp answered ${line}`));
          return;
        }
        if (index === 5) accepted = true;
        index += 1;
        if (index === steps.length) {
          socket.end();
          return;
        }
        socket.write(`${steps[index][0]}\r\n`);
      }
    });
  });
}

let running = false;
let again = false;

/** Delivers pending mail one row at a time; the row lock keeps every other copy away from it. */
export async function deliverPending(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      while (await deliverOne()) {
        /* keep going while rows are waiting */
      }
    } while (again);
  } finally {
    running = false;
  }
}

async function deliverOne(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT id, to_name, to_email, subject, body FROM outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    const row = found.rows[0] as { id: number; to_name: string | null; to_email: string; subject: string; body: string } | undefined;
    if (!row) {
      await client.query("COMMIT");
      return false;
    }
    await smtpSend({ toName: row.to_name, toEmail: row.to_email, subject: row.subject, body: row.body });
    await client.query("UPDATE outbox SET delivered_at = $2 WHERE id = $1", [row.id, nowSeconds()]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("mail delivery:", (error as Error).message);
    return false;
  } finally {
    client.release();
  }
}

function deliverSoon(): void {
  setImmediate(() => void deliverPending());
}
