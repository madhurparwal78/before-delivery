// The mail outbox worker and a minimal SMTP client for Mailpit (plain text, no authentication).
import net from "node:net";
import { config } from "./config.ts";
import { onMailCommitted, pool } from "./db.ts";

function readReply(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function command(socket: net.Socket, line: string, expect: string): Promise<void> {
  socket.write(`${line}\r\n`);
  const reply = await readReply(socket);
  if (!reply.startsWith(expect)) throw new Error(`SMTP refused ${line.split(" ")[0]}: ${reply.trim()}`);
}

const encodeHeader = (value: string): string => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`);

function fromHeader(): string {
  const match = /^(.*)<([^>]+)>\s*$/.exec(config.mailFrom);
  if (!match) return config.mailFrom;
  const name = match[1].trim().replace(/^"|"$/g, "");
  return `${/^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : encodeHeader(name)} <${match[2]}>`;
}

const envelopeFrom = (): string => /<([^>]+)>/.exec(config.mailFrom)?.[1] ?? config.mailFrom.trim();

async function deliver(to: string, subject: string, body: string): Promise<void> {
  const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(8000, () => socket.destroy(new Error("SMTP timeout")));
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const greeting = await readReply(socket);
    if (!greeting.startsWith("220")) throw new Error(`SMTP greeting: ${greeting.trim()}`);
    await command(socket, "EHLO rulehouse", "250");
    await command(socket, `MAIL FROM:<${envelopeFrom()}>`, "250");
    await command(socket, `RCPT TO:<${to}>`, "250");
    await command(socket, "DATA", "354");
    const message = [
      `From: ${fromHeader()}`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      (Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n"),
    ].join("\r\n");
    await command(socket, `${message}\r\n.`, "250");
    await command(socket, "QUIT", "221");
  } finally {
    socket.destroy();
  }
}

interface OutboxRow {
  id: number;
  to_address: string;
  subject: string;
  body: string;
}

const RETRY_MS = 10_000;
const POLL_MS = 1_000;
const retryAfter = new Map<number, number>();
let running = false;

async function sendPending(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const client = await pool.connect();
      let sent = false;
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<OutboxRow>(
          "SELECT id, to_address, subject, body FROM mail_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED",
        );
        for (const row of rows) {
          if ((retryAfter.get(row.id) ?? 0) > performance.now()) continue;
          try {
            await deliver(row.to_address, row.subject, row.body);
            await client.query("UPDATE mail_outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1", [row.id]);
            retryAfter.delete(row.id);
            sent = true;
          } catch {
            retryAfter.set(row.id, performance.now() + RETRY_MS);
            await client.query("UPDATE mail_outbox SET attempts = attempts + 1 WHERE id = $1", [row.id]);
          }
        }
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK").catch(() => undefined);
      } finally {
        client.release();
      }
      if (!sent) return;
    }
  } finally {
    running = false;
  }
}

export function startMailer(): void {
  const tick = (): void => void sendPending();
  onMailCommitted(tick);
  setInterval(tick, POLL_MS).unref();
}
