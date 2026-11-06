// SMTP delivery to the configured mail sink (plain SMTP, no authentication), one message per connection.
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { config } from "../config.js";

const TIMEOUT_MS = 10_000;

export interface OutgoingMail {
  to: { name: string; email: string };
  subject: string;
  text: string;
  html: string;
}

const isAscii = (value: string): boolean => /^[\x20-\x7e]*$/.test(value);
const encodeWord = (value: string): string => (isAscii(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`);
const mailbox = (name: string, email: string): string => {
  if (name === "") return `<${email}>`;
  return `${isAscii(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : encodeWord(name)} <${email}>`;
};
const base64Lines = (value: string): string => Buffer.from(value, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");

const senderAddress = (): string => /<([^>]+)>/.exec(config.mailFrom)?.[1] ?? config.mailFrom;

function compose(mail: OutgoingMail): string {
  const boundary = `alt-${randomUUID()}`;
  const domain = senderAddress().split("@")[1] ?? "localhost";
  return [
    `From: ${config.mailFrom}`,
    `To: ${mailbox(mail.to.name, mail.to.email)}`,
    `Subject: ${encodeWord(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
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

/** Hands one message to SMTP; resolves once the server accepted it, rejects on any failure. */
export function sendMail(mail: OutgoingMail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timed out")));
    const steps = [
      { expect: "220", send: "EHLO evidence-desk\r\n" },
      { expect: "250", send: `MAIL FROM:<${senderAddress()}>\r\n` },
      { expect: "250", send: `RCPT TO:<${mail.to.email}>\r\n` },
      { expect: "250", send: "DATA\r\n" },
      { expect: "354", send: `${compose(mail).replace(/^\./gm, "..")}\r\n.\r\n` },
      { expect: "250", send: "QUIT\r\n" },
    ];
    let buffer = "";
    let done = false;
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line[3] === "-") continue;
        const step = steps.shift();
        if (!step) continue;
        if (!line.startsWith(step.expect)) {
          socket.destroy(new Error(`SMTP refused: ${line}`));
          return;
        }
        socket.write(step.send);
        if (steps.length === 0) {
          done = true;
          resolve();
        }
      }
    });
    socket.on("error", (error) => { if (!done) reject(error); });
    socket.on("close", () => { if (!done) reject(new Error("SMTP connection closed")); });
  });
}
