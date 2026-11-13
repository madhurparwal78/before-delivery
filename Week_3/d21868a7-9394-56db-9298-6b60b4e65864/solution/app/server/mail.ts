// The district's voice: a small SMTP client for Mailpit. Every message comes from MAIL_FROM.
import { randomUUID } from "node:crypto";
import { Socket, createConnection } from "node:net";
import { config } from "./config.ts";

interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

interface MailMessage {
  to: string;
  subject: string;
  text: string;
  attachment?: MailAttachment;
}

const TIMEOUT_MS = 5000;

function address(mailbox: string): string {
  const open = mailbox.indexOf("<");
  return open >= 0 ? mailbox.slice(open + 1, mailbox.indexOf(">")) : mailbox.trim();
}

function base64Lines(content: Buffer): string {
  return (content.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function compose(message: MailMessage): string {
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${message.to}`,
    `Subject: ${headerText(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${address(config.mail.from).split("@")[1]}>`,
    "MIME-Version: 1.0",
  ];
  const textPart = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(Buffer.from(message.text))];
  if (!message.attachment) return [...headers, ...textPart].join("\r\n");
  const boundary = `ditchbook-${randomUUID()}`;
  const file = message.attachment;
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPart,
    `--${boundary}`,
    `Content-Type: ${file.contentType}; name="${file.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${file.filename}"`,
    "",
    base64Lines(file.content),
    `--${boundary}--`,
  ].join("\r\n");
}

/** One SMTP conversation; resolves the moment the server accepts the message, so nothing that goes wrong
 * while saying QUIT can make an accepted message look failed and be sent again. Rejects on any earlier failure. */
export function sendMail(message: MailMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("mail service timed out")));
    let buffer = "";
    const steps: [expect: number, send: string | null][] = [
      [220, "EHLO ditchbook"],
      [250, `MAIL FROM:<${address(config.mail.from)}>`],
      [250, `RCPT TO:<${message.to}>`],
      [250, "DATA"],
      [354, `${compose(message).replace(/^\./gm, "..")}\r\n.`],
      [250, "QUIT"],
    ];
    let step = 0;
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line[3] === "-") continue;
        const current = steps[step];
        if (!current) return;
        if (Number(line.slice(0, 3)) !== current[0]) {
          socket.destroy(new Error(`mail service answered ${line}`));
          return;
        }
        if (step === steps.length - 1) resolve();
        step += 1;
        socket.write(`${current[1]}\r\n`);
      }
    });
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("mail service closed the connection")));
  });
}
