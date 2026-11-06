import { createConnection, type Socket } from "node:net";
import type { Config } from "./config.js";

export interface OutgoingEmail {
  toEmail: string;
  toName: string | null;
  subject: string;
  textBody: string;
  htmlBody: string;
}

/**
 * A minimal SMTP client for the mail sink: one connection per message using
 * the standard HELO / MAIL / RCPT / DATA dialogue. A message is delivered
 * when the server accepts the final "." line.
 */
export async function sendSmtp(email: OutgoingEmail, config: Config): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    const socket: Socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000, () => finish(false));
    socket.on("error", () => finish(false));

    let buffer = "";
    let step = 0;

    const message = [
      `From: ${config.mailFrom}`,
      `To: ${
        email.toName !== null ? `${quoteName(email.toName)} <${email.toEmail}>` : email.toEmail
      }`,
      `Subject: ${encodeHeader(email.subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="ed-mail-part"',
      "",
      "--ed-mail-part",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      email.textBody,
      "--ed-mail-part",
      'Content-Type: text/html; charset="utf-8"',
      "",
      email.htmlBody,
      "--ed-mail-part--",
      "",
    ].join("\r\n");

    const commands = [
      "HELO evidence-desk",
      `MAIL FROM:<${extractAddress(config.mailFrom)}>`,
      `RCPT TO:<${email.toEmail}>`,
      "DATA",
    ];

    const advance = (): void => {
      const command = commands[step]!;
      step += 1;
      socket.write(`${command}\r\n`);
    };

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      const last = lines[lines.length - 1] ?? "";
      const code = Number.parseInt(last.slice(0, 3), 10);
      if (Number.isNaN(code)) return;
      if (code >= 200 && code < 400) {
        if (step === commands.length) {
          // The server asked for the message body; send it and finish.
          socket.write(`${message.replace(/^\./gm, "..")}\r\n.\r\nQUIT\r\n`);
          setTimeout(() => finish(true), 250);
        } else {
          advance();
        }
      } else if (code >= 400) {
        finish(false);
      }
    });
  });
}

function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match === null ? from.trim() : match[1]!;
}

function quoteName(name: string): string {
  return `"${name.replace(/["\\]/g, "\\$&")}"`;
}

/** Header values stay on the ASCII line, with UTF-8 bytes base64-escaped. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}
