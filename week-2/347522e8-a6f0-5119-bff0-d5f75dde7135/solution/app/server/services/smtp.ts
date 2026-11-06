// Outgoing mail over plain SMTP to SMTP_HOST:SMTP_PORT, from MAIL_FROM. One connection per message.

import { Socket } from "node:net";
import { config } from "../config.js";

const SMTP_TIMEOUT_MS = 5000;

interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

function addressOf(value: string): string {
  return /<([^>]+)>/.exec(value)?.[1] ?? value.trim();
}

function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeFrom(value: string): string {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(value);
  return match ? `${headerText(`"${match[1] ?? ""}"`)} <${match[2] ?? ""}>` : value;
}

function compose(message: MailMessage): string {
  const body = Buffer.from(message.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${encodeFrom(config.smtp.from)}`,
    `To: <${message.to}>`,
    `Subject: ${headerText(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
    ".",
    "",
  ].join("\r\n");
}

/** Delivers one message; resolves once the server accepts it, rejects on any refusal or timeout. */
export function sendMail(message: MailMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let buffer = "";
    let step = 0;
    const from = addressOf(config.smtp.from);
    const commands = [
      `EHLO railside\r\n`,
      `MAIL FROM:<${from}>\r\n`,
      `RCPT TO:<${message.to}>\r\n`,
      "DATA\r\n",
      compose(message),
      "QUIT\r\n",
    ];
    const expected = [220, 250, 250, 250, 354, 250];
    const done = (error?: Error): void => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(SMTP_TIMEOUT_MS, () => done(new Error("SMTP timed out")));
    socket.on("error", (error) => done(error));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code !== expected[step]) {
          done(new Error(`SMTP answered ${line}`));
          return;
        }
        if (step === expected.length - 1) {
          socket.write(commands[step] ?? "");
          done();
          return;
        }
        socket.write(commands[step] ?? "");
        step += 1;
      }
    });
    socket.connect(config.smtp.port, config.smtp.host);
  });
}
