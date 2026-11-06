// Mail over plain SMTP to Mailpit (brief: Services > Mailpit). Bodies and attachments go base64-encoded.
import { randomUUID } from "node:crypto";
import { Socket, connect } from "node:net";
import type { Config } from "../config.js";
import { ProviderUnavailable } from "./errors.js";

interface Mail {
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; contentType: string; content: Buffer };
}

function base64Lines(data: Buffer): string {
  return (data.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function addressOf(header: string): string {
  const match = /<([^>]+)>/.exec(header);
  return (match?.[1] ?? header).trim();
}

function compose(from: string, mail: Mail): string {
  const boundary = `pakka-${randomUUID()}`;
  const head = [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${addressOf(from).split("@").pop()}>`,
    "MIME-Version: 1.0",
  ];
  const text = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(Buffer.from(mail.text))];
  if (!mail.attachment) return [...head, ...text].join("\r\n");
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...text,
    `--${boundary}`,
    `Content-Type: ${mail.attachment.contentType}; name="${mail.attachment.filename}"`,
    `Content-Disposition: attachment; filename="${mail.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(mail.attachment.content),
    `--${boundary}--`,
  ].join("\r\n");
}

/** Reads SMTP replies line by line; each `expect` resolves with the next complete reply. */
function conversation(socket: Socket) {
  let buffer = "";
  const waiting: ((reply: string) => void)[] = [];
  const replies: string[] = [];
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (let end = buffer.search(/\r?\n/); end >= 0; end = buffer.search(/\r?\n/)) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + (buffer[end] === "\r" ? 2 : 1));
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const next = waiting.shift();
        if (next) next(line);
        else replies.push(line);
      }
    }
  });
  return (code: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const check = (line: string): void => (line.startsWith(code) ? resolve() : reject(new ProviderUnavailable(`SMTP: ${line}`)));
      const ready = replies.shift();
      if (ready) check(ready);
      else waiting.push(check);
    });
}

export function createMailer(config: Config["smtp"]) {
  return {
    async send(mail: Mail): Promise<void> {
      const socket = connect({ host: config.host, port: config.port });
      socket.setTimeout(15_000);
      const failed = new Promise<never>((_, reject) => {
        socket.once("error", (error) => reject(new ProviderUnavailable(`SMTP: ${error.message}`)));
        socket.once("timeout", () => reject(new ProviderUnavailable("SMTP: timed out")));
      });
      failed.catch(() => undefined);
      const expect = conversation(socket);
      const say = (line: string): void => {
        socket.write(`${line}\r\n`);
      };
      const dialogue = async (): Promise<void> => {
        await expect("220");
        say("EHLO pakka-rail");
        await expect("250");
        say(`MAIL FROM:<${addressOf(config.from)}>`);
        await expect("250");
        say(`RCPT TO:<${mail.to}>`);
        await expect("250");
        say("DATA");
        await expect("354");
        const message = compose(config.from, mail).replace(/^\./gm, "..");
        socket.write(`${message}\r\n.\r\n`);
        await expect("250");
        say("QUIT");
      };
      try {
        await Promise.race([dialogue(), failed]);
      } finally {
        socket.end();
        socket.destroy();
      }
    },
  };
}

export type Mailer = ReturnType<typeof createMailer>;
