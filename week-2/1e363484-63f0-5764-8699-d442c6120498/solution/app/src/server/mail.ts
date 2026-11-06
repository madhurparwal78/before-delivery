// Seal notices and broken-seal alerts over SMTP. A message counts as sent only once the mail sink
// has accepted it (250 after DATA); any other outcome is MailUnavailable.

import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "./config.js";

export class MailUnavailable extends Error {}

interface Message {
  to: string[];
  subject: string;
  lines: string[];
}

const TIMEOUT_MS = 8000;

function address(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return (match ? match[1]! : mailbox).trim();
}

/** Reads SMTP replies; each `next()` resolves with one complete (possibly multi-line) reply. */
function replies(socket: Socket) {
  let buffer = "";
  const waiting: ((reply: { code: number }) => void)[] = [];
  const ready: { code: number }[] = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)) };
        const resolve = waiting.shift();
        if (resolve) resolve(reply);
        else ready.push(reply);
      }
    }
  });
  return () => new Promise<{ code: number }>((resolve) => {
    const reply = ready.shift();
    if (reply) resolve(reply);
    else waiting.push(resolve);
  });
}

function formatMessage(message: Message): string {
  const headers = [
    `From: ${config.smtp.from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@fluxseal>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  const body = message.lines.map((line) => (line.startsWith(".") ? `.${line}` : line));
  return [...headers, "", ...body].join("\r\n");
}

export async function sendMail(message: Message): Promise<void> {
  const socket = connect({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("smtp timeout")));
  const failed = new Promise<never>((_, reject) => {
    socket.once("error", () => reject(new MailUnavailable()));
    socket.once("close", () => reject(new MailUnavailable()));
  });
  failed.catch(() => undefined);
  const next = replies(socket);
  const expect = async (accepted: number[]) => {
    const reply = await Promise.race([next(), failed]);
    if (!accepted.includes(reply.code)) throw new MailUnavailable();
  };
  const command = async (line: string, accepted: number[]) => {
    socket.write(`${line}\r\n`);
    await expect(accepted);
  };
  try {
    await expect([220]);
    await command("EHLO fluxseal", [250]);
    await command(`MAIL FROM:<${address(config.smtp.from)}>`, [250]);
    for (const to of message.to) await command(`RCPT TO:<${to}>`, [250, 251]);
    await command("DATA", [354]);
    await command(`${formatMessage(message)}\r\n.`, [250]);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}
