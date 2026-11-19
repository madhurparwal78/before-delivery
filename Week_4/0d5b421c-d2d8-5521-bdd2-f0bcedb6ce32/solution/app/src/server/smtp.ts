// A small SMTP client: one message per connection, plain text, delivered to Mailpit.
import net from "node:net";
import { config } from "./config.js";

const TIMEOUT_MS = 10_000;

function envelopeAddress(address: string): string {
  const match = /<([^>]+)>/.exec(address);
  return match?.[1] ?? address.trim();
}

function encodeBody(body: string): string {
  const base64 = Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64");
  return base64.replace(/(.{76})/g, "$1\r\n");
}

export interface Message {
  to: string;
  subject: string;
  body: string;
}

function buildMessage(message: Message): string {
  return [
    `From: ${config.mailFrom}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(message.body),
  ].join("\r\n");
}

/** Resolves once the SMTP server has accepted the message; rejects on any refusal or timeout. */
export function sendMail(message: Message): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timed out")));
    const steps = [
      "EHLO saffronslate.example",
      `MAIL FROM:<${envelopeAddress(config.mailFrom)}>`,
      `RCPT TO:<${message.to}>`,
      "DATA",
      `${buildMessage(message).replace(/^\./gm, "..")}\r\n.`,
      "QUIT",
    ];
    const expected = [250, 250, 250, 354, 250, 221];
    let pending = "";
    let step = -1;
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("SMTP connection closed early")));
    socket.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      for (;;) {
        const end = pending.indexOf("\r\n");
        if (end < 0) return;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (step >= 0 && code !== expected[step]) {
          socket.destroy();
          reject(new Error(`SMTP refused: ${line}`));
          return;
        }
        step += 1;
        const next = steps[step];
        if (next === undefined) {
          socket.removeAllListeners("close");
          socket.end();
          resolve();
          return;
        }
        socket.write(`${next}\r\n`);
      }
    });
  });
}
