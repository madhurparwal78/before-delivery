import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config";

// A plain SMTP submission to the configured mail server: EHLO, MAIL, RCPT, DATA, QUIT.

interface Message {
  to: string;
  subject: string;
  text: string;
}

function address(value: string): string {
  return /<([^>]+)>/.exec(value)?.[1] ?? value.trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function fromHeader(value: string): string {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(value.trim());
  return match ? `${encodeHeader(match[1]!.replace(/^"|"$/g, ""))} <${match[2]}>` : value;
}

function compose(message: Message): string {
  const body = Buffer.from(message.text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${fromHeader(config.mail.from)}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@pampero.ledger>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

export function send(message: Message): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP timeout")));
    const steps = [
      `EHLO pampero.ledger`,
      `MAIL FROM:<${address(config.mail.from)}>`,
      `RCPT TO:<${address(message.to)}>`,
      "DATA",
      `${compose(message).replace(/^\./gm, "..")}\r\n.`,
      "QUIT",
    ];
    let buffer = "";
    let step = -1;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) {
          socket.destroy(new Error(`SMTP ${line}`));
          return;
        }
        step += 1;
        if (step < steps.length) socket.write(`${steps[step]}\r\n`);
        else socket.end();
      }
    });
    socket.on("error", reject);
    socket.on("close", (hadError) => (hadError || step < steps.length ? reject(new Error("SMTP closed early")) : resolve()));
  });
}

export function mailHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(1_500, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("data", (chunk) => {
      socket.end("QUIT\r\n");
      resolve(chunk.toString().startsWith("220"));
    });
    socket.once("error", () => resolve(false));
  });
}
