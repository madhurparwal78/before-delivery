import { createConnection } from "node:net";
import { config } from "./config.js";
import type { MailMessage } from "./types.js";
// A permanent SMTP rejection; anything else that fails counts as unreachable.
export class MailRefused extends Error {}
// RFC 2047 encoded words, split on character boundaries so each stays short.
function encodeWords(text: string): string {
  const words: string[] = [];
  let chunk = "";
  for (const char of text) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  words.push(chunk);
  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`)
    .join(" ");
}
const plain = (text: string): boolean => /^[\x20-\x7e]*$/.test(text);
const headerText = (text: string): string =>
  plain(text) ? text : encodeWords(text);
// Display names stay one recipient: encoded when not ASCII, quoted when not plain words.
function mailbox(name: string, email: string): string {
  if (!plain(name)) return `${encodeWords(name)} <${email}>`;
  if (/^[A-Za-z0-9 ]+$/.test(name)) return `${name} <${email}>`;
  return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
}
const senderAddress = (): string =>
  /<([^>]+)>/.exec(config.mailFrom)?.[1] || config.mailFrom.trim();
export async function smtp(jobId: number, message: MailMessage): Promise<void> {
  const socket = createConnection({
    host: config.smtpHost,
    port: config.smtpPort,
  });
  socket.setTimeout(3000);
  let buffer = "";
  const replies: string[] = [];
  let waiting: ((value: string) => void) | null = null;
  let failed: Error | null = null;
  let rejectWait: ((e: Error) => void) | null = null;
  socket.on("data", (part: Buffer) => {
    buffer += part.toString();
    let end: number;
    while ((end = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line)) {
        if (waiting) {
          const callback = waiting;
          waiting = null;
          callback(line);
        } else replies.push(line);
      }
    }
  });
  socket.on("error", (error) => {
    failed = error;
    rejectWait?.(error);
  });
  socket.on("close", () => {
    if (waiting) {
      failed = new Error("SMTP connection closed");
      rejectWait?.(failed);
    }
  });
  socket.on("timeout", () => socket.destroy(new Error("SMTP timeout")));
  const receive = (): Promise<string> => {
    if (failed) return Promise.reject(failed);
    const ready = replies.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      waiting = resolve;
      rejectWait = reject;
    });
  };
  const command = async (line: string, expected: number): Promise<void> => {
    socket.write(line + "\r\n");
    const answer = await receive();
    const code = Number(answer.slice(0, 3));
    if (code >= 500) throw new MailRefused(answer);
    if (code !== expected) throw new Error(answer);
  };
  try {
    const greeting = await receive();
    if (!greeting.startsWith("220")) throw new Error(greeting);
    await command("EHLO aldermoor.example", 250);
    await command(`MAIL FROM:<${senderAddress()}>`, 250);
    await command(`RCPT TO:<${message.to_email}>`, 250);
    await command("DATA", 354);
    const data = [
      `From: ${config.mailFrom}`,
      `To: ${mailbox(message.to_name, message.to_email)}`,
      `Subject: ${headerText(message.subject)}`,
      `Message-ID: <outbox-${jobId}@aldermoor.example>`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(message.body)
        .toString("base64")
        .match(/.{1,76}/g)
        ?.join("\r\n") || "",
    ].join("\r\n");
    await command(data + "\r\n.", 250);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
    socket.destroy();
  }
}
