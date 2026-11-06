// Plain SMTP delivery to SMTP_HOST:SMTP_PORT (Mailpit), and the MIME message it carries.
import { connect, type Socket } from "node:net";
import { config } from "../config.ts";

const TIMEOUT_MS = 8000;

export type MailAttachment = { filename: string; content: Buffer };
type MailMessage = { messageId: string; to: string; subject: string; body: string; attachments: MailAttachment[] };

function encodedWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function base64Lines(data: Buffer): string {
  return (data.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function mime(message: MailMessage): string {
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${message.to}`,
    `Subject: ${encodedWord(message.subject)}`,
    `Message-ID: ${message.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];
  const text = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(Buffer.from(message.body, "utf8"))];
  if (!message.attachments.length) return [...headers, ...text].join("\r\n");
  const boundary = `kerf-${message.messageId.replace(/[^a-z0-9]/gi, "")}`;
  const parts = [`--${boundary}`, ...text];
  for (const attachment of message.attachments) {
    parts.push(`--${boundary}`, `Content-Type: application/pdf; name="${attachment.filename}"`, "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`, "", base64Lines(attachment.content));
  }
  parts.push(`--${boundary}--`);
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

class Session {
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
  }

  private flush(): void {
    // A reply is complete when a line has a space (not a dash) after its 3-digit code.
    const m = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(this.buffer);
    if (m && this.waiting) {
      const reply = this.buffer.slice(0, m.index + m[0].length);
      this.buffer = this.buffer.slice(m.index + m[0].length);
      const resolve = this.waiting;
      this.waiting = null;
      resolve(reply);
    }
  }

  reply(expect: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiting = (reply) => {
        const code = Number(reply.split("\r\n").filter(Boolean).pop()!.slice(0, 3));
        if (Math.floor(code / 100) === Math.floor(expect / 100)) resolve(reply);
        else reject(new Error(`SMTP ${code}: ${reply.trim()}`));
      };
      this.flush();
    });
  }

  async command(line: string, expect: number): Promise<string> {
    this.socket.write(line + "\r\n");
    return this.reply(expect);
  }
}

function open(): Promise<{ socket: Socket; session: Session }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.mail.smtpHost, port: config.mail.smtpPort });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout")));
    socket.once("error", reject);
    socket.once("connect", () => resolve({ socket, session: new Session(socket) }));
  });
}

/** Delivers one message; resolves once SMTP has accepted it. */
export async function deliver(message: MailMessage): Promise<void> {
  const { socket, session } = await open();
  const failed = new Promise<never>((_, reject) => socket.once("error", reject));
  const exchange = async () => {
    await session.reply(220);
    await session.command("EHLO kerf.example", 250);
    await session.command(`MAIL FROM:<${config.mail.fromAddress}>`, 250);
    await session.command(`RCPT TO:<${message.to}>`, 250);
    await session.command("DATA", 354);
    const data = mime(message).replace(/\r\n\./g, "\r\n..");
    await session.command(`${data}\r\n.`, 250);
    socket.end("QUIT\r\n");
  };
  try {
    await Promise.race([exchange(), failed]);
  } finally {
    socket.destroy();
  }
}

export async function mailUp(): Promise<boolean> {
  const smtp = open().then(async ({ socket, session }) => {
    try {
      await Promise.race([session.reply(220), new Promise<never>((_, reject) => socket.once("error", reject))]);
      return true;
    } finally {
      socket.destroy();
    }
  }).catch(() => false);
  const api = fetch(`${config.mail.mailpitUrl}/readyz`, { signal: AbortSignal.timeout(1500) })
    .then(async (response) => { await response.arrayBuffer(); return response.ok; }).catch(() => false);
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500));
  const [a, b] = await Promise.all([Promise.race([smtp, timeout]), api]);
  return a && b;
}
