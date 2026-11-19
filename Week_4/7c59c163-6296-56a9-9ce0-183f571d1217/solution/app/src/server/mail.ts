import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

function fromHeader(): string {
  const match = /^(.*)<([^>]+)>\s*$/.exec(config.smtp.from);
  return match ? `${encodeHeader((match[1] ?? "").trim())} <${match[2]}>` : config.smtp.from;
}

function render(email: Email): string {
  const body = Buffer.from(email.text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${fromHeader()}`,
    `To: <${email.to}>`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@plumtide.example>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Sends one message over plain SMTP (the sink needs no TLS or auth). */
export function sendMail(email: Email): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10000);
    const steps = [
      `EHLO plumtide-venue`,
      `MAIL FROM:<${config.smtp.envelopeFrom}>`,
      `RCPT TO:<${email.to}>`,
      "DATA",
      `${render(email).replace(/\r\n\./g, "\r\n..")}\r\n.`,
      "QUIT",
    ];
    let buffer = "";
    let step = -1;
    const fail = (detail: string) => {
      socket.destroy();
      reject(new ProviderDown("mailpit", detail));
    };
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) return fail(line);
        step += 1;
        if (step >= steps.length) {
          socket.end();
          return resolve();
        }
        socket.write(`${steps[step]}\r\n`);
      }
    });
    socket.on("timeout", () => fail("timeout"));
    socket.on("error", (error) => fail(error.message));
  });
}

export async function reachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(2000);
    socket.once("data", () => {
      socket.end("QUIT\r\n");
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}
