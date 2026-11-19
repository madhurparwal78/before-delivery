import net from "node:net";
import { config } from "./config.js";

/** A minimal SMTP client for the Mailpit sink: one message per call, failures are reported to the caller. */

const SEND_TIMEOUT_MS = 5000;

function encodeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function build(to: string, subject: string, body: string): string {
  const encoded = (Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
  return [
    `From: ${config.mail.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@jarful.local>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
    "",
  ].join("\r\n");
}

export function sendMail(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.mail.host, port: config.mail.port });
    const script: [string, string][] = [
      ["220", "EHLO jarful"],
      ["250", `MAIL FROM:<${config.mail.fromAddress}>`],
      ["250", `RCPT TO:<${to}>`],
      ["250", "DATA"],
      ["354", `${build(to, subject, body)}\r\n.`],
      ["250", "QUIT"],
    ];
    let step = 0;
    let buffer = "";
    const finish = (error?: Error): void => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(SEND_TIMEOUT_MS, () => finish(new Error("SMTP timeout")));
    socket.on("error", finish);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      const last = lines[lines.length - 2];
      if (!buffer.endsWith("\r\n") || last === undefined || /^\d{3}-/.test(last)) return;
      buffer = "";
      const [expected, next] = script[step] ?? [];
      if (expected === undefined || next === undefined) return;
      if (!last.startsWith(expected)) return finish(new Error(`SMTP: ${last}`));
      step++;
      socket.write(`${next}\r\n`);
      if (step === script.length) setTimeout(() => finish(), 20);
    });
  });
}
