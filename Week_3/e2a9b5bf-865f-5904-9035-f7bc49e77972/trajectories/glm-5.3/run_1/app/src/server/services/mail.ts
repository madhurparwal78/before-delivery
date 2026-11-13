// Minimal SMTP client over node:net (DP-41, DP-99).
// The whole exchange is limited to 10 seconds; no greeting within the limit
// counts as unreachable.
import { connect, type Socket } from "node:net";

const SMTP_LIMIT_MS = 10_000;

export class MailUnavailableError extends Error {
  constructor() {
    super("mail_unavailable");
  }
}

export class MailRejectedError extends Error {
  constructor() {
    super("mail_rejected");
  }
}

export interface MailMessage {
  readonly from: string;
  readonly toName: string;
  readonly toAddress: string;
  readonly cc: string;
  readonly subject: string;
  readonly text: string;
  readonly attachmentFilename: string;
  readonly attachment: Uint8Array;
}

export interface MailClient {
  send(message: MailMessage): Promise<void>;
}

class SmtpMail implements MailClient {
  constructor(private readonly host: string, private readonly port: number) {}

  private static encodeHeader(value: string): string {
    // RFC 2047 encoded-word for anything but plain ASCII words.
    if (/^[\x20-\x7e]*$/.test(value)) return value;
    return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
  }

  private static dotStuff(line: string): string {
    return line.startsWith(".") ? `.${line}` : line;
  }

  async send(message: MailMessage): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket: Socket = connect(this.port, this.host);
      let buffer = "";
      let stage = 0;
      let settled = false;
      const finish = (error: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => finish(new MailUnavailableError()), SMTP_LIMIT_MS);
      socket.setTimeout(SMTP_LIMIT_MS);
      socket.on("error", () => finish(new MailUnavailableError()));
      const failIfRefused = (code: number) => {
        if (code >= 400) finish(new MailRejectedError());
      };
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let index: number;
        while ((index = buffer.indexOf("\r\n")) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const code = Number(line.slice(0, 3));
          if (line.length > 3 && line[3] === "-") continue; // multiline reply
          failIfRefused(code);
          if (settled) return;
          stage += 1;
          switch (stage) {
            case 1: socket.write(`EHLO lowlamp\r\n`); break;
            case 2: socket.write(`MAIL FROM:${SmtpMail.addressOnly(message.from)}\r\n`); break;
            case 3: socket.write(`RCPT TO:<${message.toAddress}>\r\n`); break;
            case 4: socket.write(`RCPT TO:${SmtpMail.addressOnly(message.cc)}\r\n`); break;
            case 5: socket.write(`DATA\r\n`); break;
            case 6: socket.write(SmtpMail.messageBody(message)); socket.write(`.\r\n`); break;
            case 7: socket.write(`QUIT\r\n`); finish(null); break;
            default: break;
          }
        }
      });
    });
  }

  private static addressOnly(header: string): string {
    const match = /<([^>]*)>/.exec(header);
    return match ? `<${match[1]}>` : `<${header.trim()}>`;
  }

  private static messageBody(message: MailMessage): string {
    const boundary = `lowlamp-${Date.now()}`;
    const fromLine = message.from.includes("<")
      ? message.from
      : `Lowlamp Field Log <${message.from}>`;
    const toLine = message.toName.includes("<")
      ? message.toName
      : `${SmtpMail.encodeHeader(message.toName)} <${message.toAddress}>`;
    const headers = [
      `From: ${fromLine}`,
      `To: ${toLine}`,
      `Cc: ${message.cc}`,
      `Subject: ${SmtpMail.encodeHeader(message.subject)}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
    ].join("\r\n");
    const textPart = [
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      ...message.text.split("\n").map((line) => SmtpMail.dotStuff(line)),
      ``,
    ].join("\r\n");
    const attachmentPart = [
      `--${boundary}`,
      `Content-Type: application/pdf; name="${message.attachmentFilename}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${message.attachmentFilename}"`,
      ``,
      ...Buffer.from(message.attachment).toString("base64").replace(/(.{76})/g, "$1").split(/\n/),
      ``,
    ].join("\r\n");
    const closing = `--${boundary}--\r\n`;
    return `${headers}\r\n${textPart}\r\n${attachmentPart}\r\n${closing}`;
  }
}

export function makeMail(host: string, port: number): MailClient {
  return new SmtpMail(host, port);
}
