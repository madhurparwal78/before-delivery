// SMTP to SMTP_HOST:SMTP_PORT, From taken from MAIL_FROM. One To recipient per message, no Cc or Bcc.
import net from "node:net";
import crypto from "node:crypto";
import { config } from "./config.js";

export class MailDown extends Error {}

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function envelopeFrom(): string {
  const match = /<([^>]+)>/.exec(config.smtp.from);
  return (match?.[1] ?? config.smtp.from).trim();
}

/** RFC 2047 encoded words for a non-ASCII subject, split on character boundaries. */
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const words: string[] = [];
  let chunk = "";
  for (const char of subject) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}

function base64Lines(value: string): string {
  return (Buffer.from(value).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function compose(mail: Mail): string {
  const boundary = `lf-${crypto.randomBytes(12).toString("hex")}`;
  const domain = envelopeFrom().split("@")[1] ?? "localhost";
  return [
    `From: ${config.smtp.from}`,
    `To: <${mail.to}>`,
    `Subject: ${encodeSubject(mail.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(mail.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(mail.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Sends one message. Throws MailDown when the server cannot be reached or refuses it. */
export function send(mail: Mail): Promise<void> {
  if (/[\r\n<>,;\s]/.test(mail.to)) return Promise.reject(new Error("recipient must be a bare address"));
  const steps = [`EHLO lanternfold`, `MAIL FROM:<${envelopeFrom()}>`, `RCPT TO:<${mail.to}>`, "DATA", `${compose(mail).replace(/^\./gm, "..")}\r\n.`, "QUIT"];
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000);
    let buffer = "";
    let step = -1;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.on("timeout", () => finish(new MailDown("SMTP timed out")));
    socket.on("error", (error) => finish(new MailDown(error.message)));
    socket.on("close", () => finish(step >= steps.length - 1 ? undefined : new MailDown("SMTP connection closed")));
    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) {
          finish(new MailDown(`SMTP ${line}`));
          return;
        }
        step += 1;
        if (step === steps.length) {
          finish();
          return;
        }
        socket.write(`${steps[step]}\r\n`);
      }
    });
  });
}

export function healthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(3000);
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("data", (data: Buffer) => done(data.toString().startsWith("220")));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}
