import { Socket } from "node:net";
import { config, SERVICE_TIMEOUT_MS } from "./config.js";

// A minimal SMTP client (RFC 5321) for the mail service the brief provides.

export class MailUnavailable extends Error {}

export type Letter = { to: string; subject: string; text: string };

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1] : value).trim();
}

function header(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function render(letter: Letter, messageId: string): string {
  const body = letter.text
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: ${letter.to}`,
    `Subject: ${header(letter.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

/** Sends one message. Rejects with MailUnavailable when the server is unreachable or refuses. */
export function sendMail(letter: Letter, messageId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let buffer = "";
    let step = 0;
    const script: [string | null, number][] = [
      [null, 220],
      ["EHLO tidemark.test", 250],
      [`MAIL FROM:<${address(config.smtp.from)}>`, 250],
      [`RCPT TO:<${address(letter.to)}>`, 250],
      ["DATA", 354],
      [`${render(letter, messageId)}\r\n.`, 250],
      ["QUIT", 221],
    ];
    const fail = (reason: string) => {
      socket.destroy();
      reject(new MailUnavailable(reason));
    };
    socket.setTimeout(SERVICE_TIMEOUT_MS, () => fail("SMTP timed out"));
    socket.on("error", () => fail("SMTP connection failed"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code !== script[step][1]) {
          if (step >= 6) break;
          fail(`SMTP refused with ${code}`);
          return;
        }
        step += 1;
        if (step === script.length) {
          socket.end();
          resolve();
          return;
        }
        if (step === 6) resolve();
        socket.write(`${script[step][0]}\r\n`);
      }
    });
    socket.connect(config.smtp.port, config.smtp.host);
  });
}
