import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config";

/** A minimal SMTP client: a message counts as sent only when the server accepts it for delivery. */

const STEP_TIMEOUT_MS = 4000;

class MailUnavailable extends Error {}

function address(from: string): string {
  const start = from.indexOf("<");
  return start >= 0 ? from.slice(start + 1, from.indexOf(">")) : from.trim();
}

function reader(socket: Socket): (expected: number) => Promise<void> {
  let buffer = "";
  const waiting: { expected: number; resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  const settle = (): void => {
    for (;;) {
      const newline = buffer.indexOf("\r\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      if (/^\d{3}-/.test(line)) {
        buffer = buffer.slice(newline + 2);
        continue;
      }
      buffer = buffer.slice(newline + 2);
      const next = waiting.shift();
      if (!next) continue;
      clearTimeout(next.timer);
      if (Number(line.slice(0, 3)) === next.expected) next.resolve();
      else next.reject(new MailUnavailable(line));
    }
  };
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    settle();
  });
  const failAll = (error: Error): void => {
    while (waiting.length) {
      const next = waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.reject(error);
      }
    }
  };
  socket.on("error", failAll);
  socket.on("close", () => failAll(new MailUnavailable("closed")));
  return (expected) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new MailUnavailable("timeout")), STEP_TIMEOUT_MS);
      waiting.push({ expected, resolve, reject, timer });
      settle();
    });
}

export async function sendMail(to: string, subject: string, body: string): Promise<boolean> {
  if (!config.smtpHost) return false;
  const socket = createConnection({ host: config.smtpHost, port: config.smtpPort });
  socket.setTimeout(STEP_TIMEOUT_MS * 2, () => socket.destroy());
  const expect = reader(socket);
  const command = async (line: string, code: number): Promise<void> => {
    socket.write(`${line}\r\n`);
    await expect(code);
  };
  try {
    await expect(220);
    await command("EHLO duecoin.local", 250);
    await command(`MAIL FROM:<${address(config.mailFrom)}>`, 250);
    await command(`RCPT TO:<${to}>`, 250);
    await command("DATA", 354);
    const lines = [
      `From: ${config.mailFrom}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@duecoin.local>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      ...body.split("\n").map((l) => (l.startsWith(".") ? `.${l}` : l)),
    ];
    socket.write(`${lines.join("\r\n")}\r\n.\r\n`);
    await expect(250);
    socket.write("QUIT\r\n");
    return true;
  } catch {
    return false;
  } finally {
    socket.destroy();
  }
}
