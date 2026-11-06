import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "../config.js";

const TIMEOUT_MS = 5000;

interface Message {
  to: string;
  subject: string;
  text: string;
}

function address(from: string): string {
  const start = from.indexOf("<");
  return start === -1 ? from.trim() : from.slice(start + 1, from.indexOf(">"));
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function render(message: Message): string {
  const body = Buffer.from(message.text).toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${config.mailFrom}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@paddock>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** One SMTP conversation with the configured server; rejects unless the server accepts the message. */
export function sendMail(message: Message): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS);
    let buffer = "";
    let waiting: { expect: number; next: () => void } | null = null;
    const steps: { send: string; expect: number }[] = [
      { send: "EHLO paddock", expect: 250 },
      { send: `MAIL FROM:<${address(config.mailFrom)}>`, expect: 250 },
      { send: `RCPT TO:<${message.to}>`, expect: 250 },
      { send: "DATA", expect: 354 },
      { send: `${render(message)}\r\n.`, expect: 250 },
      { send: "QUIT", expect: 221 },
    ];
    let index = 0;
    const fail = (reason: string): void => {
      socket.destroy();
      reject(new Error(reason));
    };
    const advance = (): void => {
      const step = steps[index];
      if (!step) {
        socket.end();
        resolve();
        return;
      }
      index += 1;
      waiting = { expect: step.expect, next: advance };
      socket.write(`${step.send}\r\n`);
    };
    waiting = { expect: 220, next: advance };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line[3] === "-" || !waiting) continue;
        const current = waiting;
        waiting = null;
        if (Number(line.slice(0, 3)) !== current.expect) fail(`smtp: ${line}`);
        else current.next();
      }
    });
    socket.on("timeout", () => fail("smtp: timed out"));
    socket.on("error", (error) => fail(error.message));
  });
}
