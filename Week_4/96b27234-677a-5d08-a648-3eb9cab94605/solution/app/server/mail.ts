import { Socket, connect } from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { one, query, tx, type Db } from "./db.js";

const encodedSubject = (subject: string): string =>
  /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;

const envelopeAddress = (value: string): string => (value.includes("<") ? value.slice(value.indexOf("<") + 1, value.indexOf(">")) : value.trim());

/** Queues one mail in the outbox; the sender retries until the mail server accepts it. */
export async function enqueueMail(to: string, subject: string, body: string, db?: Db): Promise<void> {
  await query("INSERT INTO outbox (to_addr, subject, body) VALUES ($1, $2, $3)", [to, subject, body], db);
}

export const absoluteUrl = (origin: string | undefined, path: string): string =>
  `${(config.publicUrl || origin || `http://localhost:${config.port}`).replace(/\/$/, "")}${path}`;

function conversation(socket: Socket, lines: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let step = -1;
    const fail = (message: string): void => {
      socket.destroy();
      reject(new Error(message));
    };
    socket.setTimeout(10_000, () => fail("smtp timeout"));
    socket.on("error", (error) => fail(error.message));
    socket.on("close", () => (step >= lines.length ? resolve() : fail("smtp closed early")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const expected = step < 0 ? 220 : (lines[step]?.startsWith("DATA\r\n") ? 354 : step === lines.length - 1 ? 221 : null);
        if (code >= 400 || (expected !== null && code !== expected && !(step === lines.length - 1 && code === 221))) return fail(`smtp ${line}`);
        step += 1;
        const next = lines[step];
        if (next === undefined) return;
        socket.write(next);
        if (step === lines.length - 1) step = lines.length;
      }
    });
  });
}

async function deliver(to: string, subject: string, body: string): Promise<void> {
  const from = config.smtp.from;
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject(subject)}`,
    `Message-ID: <${randomUUID()}@hearthtile.example>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ].join("\r\n");
  const socket = connect({ host: config.smtp.host, port: config.smtp.port });
  await conversation(socket, [
    "EHLO hearthtile.example\r\n",
    `MAIL FROM:<${envelopeAddress(from)}>\r\n`,
    `RCPT TO:<${to}>\r\n`,
    "DATA\r\n",
    `${message}\r\n.\r\n`,
    "QUIT\r\n",
  ]);
}

interface OutboxRow {
  id: number;
  to_addr: string;
  subject: string;
  body: string;
}

/** Sends one due mail; other instances skip a row that is being sent. */
export async function sendDueMail(): Promise<boolean> {
  return tx(async (client) => {
    const row = await one<OutboxRow>(
      "SELECT id, to_addr, subject, body FROM outbox WHERE sent_at IS NULL AND next_at <= now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
      [],
      client,
    );
    if (!row) return false;
    try {
      await deliver(row.to_addr, row.subject, row.body);
      await query("UPDATE outbox SET sent_at = now() WHERE id = $1", [row.id], client);
    } catch {
      await query("UPDATE outbox SET next_at = now() + interval '2 seconds' WHERE id = $1", [row.id], client);
    }
    return true;
  });
}
