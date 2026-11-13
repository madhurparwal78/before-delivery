import { connect, type Socket } from "node:net";
import { config, LIMITS } from "./config";
import { MailRejected, MailUnavailable } from "./errors";

interface Outgoing {
  to: { name: string; address: string };
  cc: string;
  subject: string;
  text: string;
  attachment: { filename: string; type: string; content: Buffer };
}

const CRLF = "\r\n";
const wrap76 = (b64: string) => b64.match(/.{1,76}/g)?.join(CRLF) ?? "";
const noBreaks = (value: string) => value.replace(/[\r\n]+/g, " ");

/** RFC 2047 encoded words of at most 75 characters, folded onto continuation lines. */
function encodedWords(text: string): string {
  const words: string[] = [];
  let current = "";
  for (const ch of text) {
    if (Buffer.byteLength(current + ch) > 42) {
      words.push(current);
      current = "";
    }
    current += ch;
  }
  if (current) words.push(current);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join(`${CRLF} `);
}

function addressOf(mailbox: string): string {
  const m = /<([^>]+)>/.exec(mailbox);
  return (m?.[1] ?? mailbox).trim();
}

function fromHeader(): string {
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(noBreaks(config.mailFrom));
  if (!m) return noBreaks(config.mailFrom);
  const name = m[1] ?? "";
  const shown = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "")}"` : encodedWords(name);
  return `${shown} <${m[2]}>`;
}

function buildMessage(mail: Outgoing, boundary: string): string {
  const to = /^[\x20-\x7e]*$/.test(mail.to.name) ? `"${mail.to.name.replace(/["\\]/g, "")}"` : encodedWords(mail.to.name);
  return [
    `From: ${fromHeader()}`,
    `To: ${to} <${mail.to.address}>`,
    `Cc: <${mail.cc}>`,
    `Subject: ${encodedWords(noBreaks(mail.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${boundary}@lowlamp.test>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(mail.text).toString("base64")),
    `--${boundary}`,
    `Content-Type: ${mail.attachment.type}; name="${mail.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${mail.attachment.filename}"`,
    "",
    wrap76(mail.attachment.content.toString("base64")),
    `--${boundary}--`,
    "",
  ].join(CRLF);
}

class Dialog {
  private buffer = "";
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", () => this.failure?.(new MailUnavailable()));
    socket.on("close", () => this.failure?.(new MailUnavailable()));
  }

  private flush(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split(CRLF);
    const last = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
    if (last < 0) return;
    const text = lines.slice(0, last + 1).join("\n");
    this.buffer = lines.slice(last + 1).join(CRLF);
    const resolve = this.waiting;
    this.waiting = null;
    resolve({ code: Number(lines[last]?.slice(0, 3)), text });
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      this.waiting = resolve;
      this.failure = reject;
      this.flush();
    });
  }

  async command(line: string, expect: number): Promise<void> {
    this.socket.write(line + CRLF);
    await this.expect(expect);
  }

  async expect(code: number): Promise<void> {
    const reply = await this.reply();
    if (reply.code === code) return;
    throw reply.code >= 500 ? new MailRejected() : new MailUnavailable();
  }

  write(data: string): void {
    this.socket.write(data);
  }
}

/** One fresh SMTP exchange, limited to ten seconds in total. */
export async function sendMail(mail: Outgoing): Promise<void> {
  const socket = connect({ host: config.smtp.host, port: config.smtp.port });
  const deadline = setTimeout(() => socket.destroy(), LIMITS.providerSeconds * 1000);
  const dialog = new Dialog(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", () => reject(new MailUnavailable()));
    });
    await dialog.expect(220);
    await dialog.command("EHLO lowlamp.test", 250);
    await dialog.command(`MAIL FROM:<${addressOf(config.mailFrom)}>`, 250);
    await dialog.command(`RCPT TO:<${mail.to.address}>`, 250);
    await dialog.command(`RCPT TO:<${mail.cc}>`, 250);
    await dialog.command("DATA", 354);
    const boundary = `lowlamp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    dialog.write(buildMessage(mail, boundary).replace(/^\./gm, "..") + `.${CRLF}`);
    await dialog.expect(250);
    socket.write(`QUIT${CRLF}`);
  } finally {
    clearTimeout(deadline);
    socket.destroy();
  }
}
