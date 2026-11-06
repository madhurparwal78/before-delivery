import { connect, type Socket } from "node:net";

export interface MailAttachment {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  attachments: MailAttachment[];
}

export class SmtpUnavailable extends Error {}

function headerValue(value: string): string {
  return value.replace(/[\r\n]/g, " ");
}

function encodeAttachment(bytes: Buffer): string {
  return bytes.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

export function buildMime(message: MailMessage): Buffer {
  const boundary = "kerf-" + Buffer.from(message.messageId).toString("hex").slice(0, 24);
  const headers = [
    `From: ${headerValue(message.from)}`,
    `To: ${headerValue(message.to)}`,
    `Subject: ${headerValue(message.subject)}`,
    `Message-ID: <${message.messageId}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts: string[] = [];
  parts.push(
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      message.text,
      "",
    ].join("\r\n"),
  );
  for (const a of message.attachments) {
    parts.push(
      [
        `--${boundary}`,
        `Content-Type: ${a.contentType}; name="${headerValue(a.filename)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${headerValue(a.filename)}"`,
        "",
        encodeAttachment(a.bytes),
        "",
      ].join("\r\n"),
    );
  }
  parts.push(`--${boundary}--\r\n`);
  return Buffer.from(headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + "\r\n", "utf8");
}

export async function smtpSend(host: string, port: number, message: MailMessage): Promise<void> {
  const mime = buildMime(message);
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host, port });
    let buffer = "";
    let stage = 0;
    const fail = (e: Error): void => {
      socket.destroy();
      reject(e);
    };
    socket.setTimeout(8000, () => fail(new SmtpUnavailable("smtp timeout")));
    socket.on("error", (e) => fail(new SmtpUnavailable(e.message)));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (!buffer.endsWith("\r\n")) return;
      const lines = buffer.split("\r\n");
      const last = lines[lines.length - 2] ?? "";
      const code = Number(last.slice(0, 3));
      buffer = "";
      if (code >= 500 && stage > 0) {
        fail(new SmtpUnavailable(`smtp refused: ${last}`));
        return;
      }
      stage += 1;
      switch (stage) {
        case 1:
          socket.write(`EHLO kerf\r\n`);
          return;
        case 2: {
          const fromAddr = /<([^>]+)>/.exec(message.from)?.[1] ?? message.from;
          socket.write(`MAIL FROM:<${fromAddr}>\r\n`);
          return;
        }
        case 3:
          socket.write(`RCPT TO:<${message.to}>\r\n`);
          return;
        case 4:
          socket.write(`DATA\r\n`);
          return;
        case 5:
          socket.write(mime);
          socket.write(`.\r\n`);
          return;
        case 6:
          socket.write(`QUIT\r\n`);
          return;
        case 7:
          socket.end();
          resolve();
          return;
        default:
          return;
      }
    });
  });
}
