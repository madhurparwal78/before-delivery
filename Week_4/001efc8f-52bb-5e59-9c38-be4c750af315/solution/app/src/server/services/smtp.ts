import { randomUUID } from "node:crypto";
import net from "node:net";
import { now } from "../clock.js";
import { config } from "../config.js";
import { markService } from "./health.js";

// A plain SMTP client for the configured relay (Mailpit). No Cc or Bcc header is ever written.

type Mail = { toName: string; toAddress: string; subject: string; text: string };

const SAFE_HEADER = /^[^\r\n\0\u0085\u2028\u2029]*$/;

function headerValue(value: string, field: string): string {
  if (!SAFE_HEADER.test(value)) throw new RangeError(`unsafe ${field} header value`);
  return value;
}

function encodeWords(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}

function displayName(name: string): string {
  return /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : encodeWords(name);
}

function envelopeAddress(header: string): string {
  return /<([^>]+)>/.exec(header)?.[1]?.trim() ?? header.trim();
}

function compose(mail: Mail): string {
  const body = Buffer.from(mail.text.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/.{76}/g, "$&\r\n");
  const domain = envelopeAddress(config.mailFrom).split("@")[1] ?? "localhost";
  return [
    `From: ${headerValue(config.mailFrom, "From")}`,
    `To: ${displayName(headerValue(mail.toName, "To"))} <${headerValue(mail.toAddress, "To")}>`,
    `Subject: ${encodeWords(headerValue(mail.subject, "Subject"))}`,
    `Date: ${now().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

type Conversation = { send: (line: string) => Promise<void>; expect: (code: number) => Promise<void>; close: () => void };

function converse(timeoutMs: number): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("smtp timeout")));
    let buffer = "";
    let waiting: ((reply: string) => void) | null = null;
    let failure: Error | null = null;
    const failWaiting = (error: Error) => {
      failure = error;
      waiting?.("");
    };
    socket.on("error", (error) => {
      failWaiting(error);
      reject(error);
    });
    socket.on("close", () => failWaiting(new Error("smtp closed")));
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      const lines = buffer.split("\r\n");
      const complete = lines.findIndex((line) => /^\d{3} /.test(line));
      if (complete >= 0 && waiting) {
        const reply = lines.slice(0, complete + 1).join("\n");
        buffer = lines.slice(complete + 1).join("\r\n");
        const done = waiting;
        waiting = null;
        done(reply);
      }
    });
    const expect = (code: number) =>
      new Promise<void>((ok, fail) => {
        const check = (reply: string) => (failure ? fail(failure) : reply.startsWith(String(code)) ? ok() : fail(new Error(`smtp ${reply.slice(0, 3)}`)));
        const lines = buffer.split("\r\n");
        const complete = lines.findIndex((line) => /^\d{3} /.test(line));
        if (failure && complete < 0) {
          fail(failure);
        } else if (complete >= 0) {
          const reply = lines.slice(0, complete + 1).join("\n");
          buffer = lines.slice(complete + 1).join("\r\n");
          check(reply);
        } else {
          waiting = check;
        }
      });
    socket.on("connect", () =>
      resolve({
        send: (line) => new Promise((ok, fail) => socket.write(`${line}\r\n`, (error) => (error ? fail(error) : ok()))),
        expect,
        close: () => socket.end(),
      }),
    );
  });
}

export async function sendMail(mail: Mail): Promise<void> {
  try {
    const smtp = await converse(10_000);
    try {
      await smtp.expect(220);
      await smtp.send("EHLO rimewire");
      await smtp.expect(250);
      await smtp.send(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`);
      await smtp.expect(250);
      await smtp.send(`RCPT TO:<${headerValue(mail.toAddress, "To")}>`);
      await smtp.expect(250);
      await smtp.send("DATA");
      await smtp.expect(354);
      await smtp.send(`${compose(mail).replace(/^\./gm, "..")}\r\n.`);
      await smtp.expect(250);
      await smtp.send("QUIT");
    } finally {
      smtp.close();
    }
    markService("mail", true);
  } catch (error) {
    markService("mail", false);
    throw error;
  }
}

// Reachable when the server accepts a connection and greets.
export async function mailReachable(): Promise<boolean> {
  try {
    const smtp = await converse(3_000);
    try {
      await smtp.expect(220);
      await smtp.send("QUIT");
      return true;
    } finally {
      smtp.close();
    }
  } catch {
    return false;
  }
}
