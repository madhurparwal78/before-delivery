// SMTP to the mail server Mailpit captures (brief: Services > Mail). A minimal client: one message per
// connection, plain text only, so nothing is queued in-process.
import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { Unavailable } from "./errors.js";

const TIMEOUT_MS = 10_000;

interface Message {
  to: string;
  subject: string;
  /** Lines of the plain-text body; each is sent with a CRLF ending. */
  lines: string[];
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let current = "";
  for (const char of value) {
    if (Buffer.byteLength(current + char) > 42) {
      words.push(current);
      current = "";
    }
    current += char;
  }
  if (current) words.push(current);
  return words.map((word) => `=?utf-8?B?${Buffer.from(word).toString("base64")}?=`).join("\r\n ");
}

function render(message: Message): string {
  const domain = config.mailFromAddress.split("@")[1] ?? "localhost";
  const body = Buffer.from(message.lines.map((line) => `${line}\r\n`).join(""), "utf8").toString("base64");
  const wrapped = body.match(/.{1,76}/g)?.join("\r\n") ?? "";
  return [
    `From: ${config.mailFrom}`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapped,
  ].join("\r\n");
}

/** Sends one message; any network or protocol failure becomes `mail_unavailable`. */
export function sendMail(message: Message): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS);
    // Each reply code we wait for, and the command that follows it. The message is accepted at the last 250.
    const steps: Array<{ expect: number; send: string }> = [
      { expect: 220, send: "EHLO rushes" },
      { expect: 250, send: `MAIL FROM:<${config.mailFromAddress}>` },
      { expect: 250, send: `RCPT TO:<${message.to}>` },
      { expect: 250, send: "DATA" },
      { expect: 354, send: `${render(message)}\r\n.` },
      { expect: 250, send: "QUIT" },
    ];
    let buffer = "";
    let finished = false;
    const finish = (error?: unknown): void => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) reject(new Unavailable("mail_unavailable", error));
      else resolve();
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3}-/.test(line)) continue;
        const step = steps.shift();
        if (!step) return;
        if (Number(line.slice(0, 3)) !== step.expect) return finish(new Error(`SMTP ${line}`));
        socket.write(`${step.send}\r\n`);
        if (!steps.length) return finish();
      }
    });
    socket.on("timeout", () => finish(new Error("SMTP timeout")));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(steps.length ? new Error("SMTP closed") : undefined));
  });
}
