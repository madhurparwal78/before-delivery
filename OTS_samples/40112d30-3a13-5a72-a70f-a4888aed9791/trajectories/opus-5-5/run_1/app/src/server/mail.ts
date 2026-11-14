import { randomUUID } from "node:crypto";
import net from "node:net";
import type pg from "pg";
import { now } from "./clock.js";
import { config } from "./config.js";
import { one, query, tx } from "./db.js";

const SMTP_TIMEOUT_MS = 5000;
const RETRY_EVERY_MS = 10000;

function address(text: string): string {
  const match = /<([^>]+)>/.exec(text);
  return (match ? match[1] : text).trim();
}

function encodeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function fromHeader(): string {
  const match = /^(.*)<([^>]+)>\s*$/.exec(config.mailFrom);
  if (!match) return config.mailFrom;
  const name = match[1].trim();
  return name ? `${encodeHeader(name)} <${match[2]}>` : `<${match[2]}>`;
}

/** Sends one message over SMTP; rejects when the server is unreachable or refuses it. */
function sendSmtp(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout")));
    const message = [
      `From: ${fromHeader()}`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@nightform>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      (Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n"),
    ].join("\r\n");
    const steps: [string | null, number][] = [
      [null, 220],
      ["EHLO nightform", 250],
      [`MAIL FROM:<${address(config.mailFrom)}>`, 250],
      [`RCPT TO:<${to}>`, 250],
      ["DATA", 354],
      [`${message}\r\n.`, 250],
      ["QUIT", 221],
    ];
    let step = 0;
    let buffer = "";
    let done = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code !== steps[step][1]) {
          socket.destroy();
          reject(new Error(`SMTP ${line}`));
          return;
        }
        step++;
        if (step === steps.length - 1) {
          done = true;
          resolve();
        }
        if (step < steps.length) socket.write(`${steps[step][0]}\r\n`);
        else socket.end();
      }
    });
    socket.on("error", (error) => {
      if (!done) reject(error);
    });
    socket.on("close", () => {
      if (!done) reject(new Error("SMTP closed"));
    });
  });
}

/** Writes an email to the durable outbox inside the caller's transaction. */
export async function enqueueMail(client: pg.PoolClient, to: string, subject: string, body: string): Promise<string> {
  const row = await one<{ id: string }>(
    "INSERT INTO outbox (recipient, subject, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
    [to, subject, body, now()],
    client,
  );
  return (row as { id: string }).id;
}

type Delivery = "sent" | "failed" | "busy";

async function deliver(id: string, skipLocked: boolean): Promise<Delivery> {
  return tx(async (client): Promise<Delivery> => {
    const row = await one<{ recipient: string; subject: string; body: string; sent_at: Date | null }>(
      `SELECT recipient, subject, body, sent_at FROM outbox WHERE id = $1 FOR UPDATE${skipLocked ? " SKIP LOCKED" : ""}`,
      [id],
      client,
    );
    if (!row) return "busy";
    if (row.sent_at) return "sent";
    try {
      await sendSmtp(row.recipient, row.subject, row.body);
    } catch {
      await client.query("UPDATE outbox SET attempts = attempts + 1 WHERE id = $1", [id]);
      return "failed";
    }
    await client.query("UPDATE outbox SET sent_at = $2, attempts = attempts + 1 WHERE id = $1", [id, now()]);
    return "sent";
  });
}

/** Tries to deliver one queued email now; true once Mailpit has accepted it. */
export function deliverNow(id: string): Promise<boolean> {
  return deliver(id, false).then(
    (result) => result === "sent",
    () => false,
  );
}

async function deliverPending(): Promise<void> {
  const rows = await query<{ id: string }>("SELECT id FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 50");
  for (const row of rows) if ((await deliver(row.id, true)) === "failed") break;
}

export function startOutbox(): void {
  const loop = (): void => {
    deliverPending()
      .catch(() => undefined)
      .finally(() => setTimeout(loop, RETRY_EVERY_MS));
  };
  setTimeout(loop, RETRY_EVERY_MS);
}

export function smtpUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}
