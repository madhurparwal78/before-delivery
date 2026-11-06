// Plain-text mail over SMTP to Mailpit (brief: Services). A failed hand-off rejects, so callers can undo.
import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { config } from "./config";

interface Mail {
  to: string;
  subject: string;
  text: string;
}

function address(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match ? match[1] : from).trim();
}

function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function fromHeader(from: string): string {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match && match[1] ? `${headerText(match[1])} <${match[2]}>` : from;
}

function message(mail: Mail): string {
  const body = mail.text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return [
    `From: ${fromHeader(config.smtp.from)}`,
    `To: <${mail.to}>`,
    `Subject: ${headerText(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@tidewright.example>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

export function sendMail(mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const steps = [
      `EHLO tidewright.example`,
      `MAIL FROM:<${address(config.smtp.from)}>`,
      `RCPT TO:<${mail.to}>`,
      "DATA",
      `${message(mail)}\r\n.`,
      "QUIT",
    ];
    let buffer = "";
    let step = -1;
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(10_000, () => fail(new Error("smtp timeout")));
    socket.on("error", fail);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const expected = step === 3 ? 354 : step === 5 ? 221 : step === -1 ? 220 : 250;
        if (code !== expected && !(step === 0 && code === 250)) {
          fail(new Error(`smtp: ${line}`));
          return;
        }
        step += 1;
        if (step === steps.length) {
          socket.end();
          resolve();
          return;
        }
        socket.write(`${steps[step]}\r\n`);
      }
    });
    socket.connect(config.smtp.port, config.smtp.host);
  });
}
