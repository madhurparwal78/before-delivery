import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "./config.ts";

/** The mail service is down when an SMTP connection fails or takes longer than 5 seconds. */
const SMTP_TIMEOUT_MS = 5_000;

type MailMessage = { key: string; to: string; subject: string; text: string };

const fromAddress = (): string => {
  const match = /<([^>]+)>/.exec(config.smtp.from);
  return (match?.[1] ?? config.smtp.from).trim();
};

/** The domain of the `MAIL_FROM` address, used for EHLO and `Message-ID`. */
const senderDomain = (): string => fromAddress().replace(/^[^@]*@/, "");

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

function encodeFrom(value: string): string {
  const match = /^(.*)<([^>]+)>\s*$/.exec(value);
  if (!match) return value;
  return `${encodeHeader((match[1] ?? "").trim())} <${match[2]}>`;
}

function render(message: MailMessage): string {
  const body = Buffer.from(message.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${encodeFrom(config.smtp.from)}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now().toString(36)}.${randomBytes(9).toString("base64url")}@${senderDomain()}>`,
    `X-Halide-Message-Key: ${message.key}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** A minimal SMTP conversation: reads one reply per command and fails on any non-2xx/3xx code. */
class Conversation {
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
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i += 1) {
      const line = lines[i] ?? "";
      if (/^\d{3} /.test(line) && this.waiting) {
        this.buffer = lines.slice(i + 1).join("\r\n");
        const resolve = this.waiting;
        this.waiting = null;
        resolve(line);
        return;
      }
    }
  }

  reply(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiting = (line) => (Number(line.slice(0, 3)) < 400 ? resolve(line) : reject(new Error(line)));
      this.flush();
    });
  }

  async command(line: string): Promise<string> {
    this.socket.write(`${line}\r\n`);
    return this.reply();
  }
}

function open(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout")));
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** Sends one message to the SMTP server named by `SMTP_HOST`/`SMTP_PORT` (no auth). */
export async function sendMail(message: MailMessage): Promise<void> {
  const socket = await open();
  const failed = new Promise<never>((_, reject) => socket.once("error", reject).once("close", () => reject(new Error("SMTP closed"))));
  failed.catch(() => undefined);
  const talk = async (): Promise<void> => {
    const smtp = new Conversation(socket);
    await smtp.reply();
    await smtp.command(`EHLO ${senderDomain()}`);
    await smtp.command(`MAIL FROM:<${fromAddress()}>`);
    await smtp.command(`RCPT TO:<${message.to}>`);
    await smtp.command("DATA");
    const data = render(message).replace(/\r\n\./g, "\r\n..");
    await smtp.command(`${data}\r\n.`);
    await smtp.command("QUIT").catch(() => "");
  };
  try {
    await Promise.race([talk(), failed]);
  } finally {
    socket.destroy();
  }
}

/** Connect probe: the server must answer its greeting within 5 seconds. */
export async function probeMail(): Promise<boolean> {
  try {
    const socket = await open();
    try {
      const closed = new Promise<never>((_, reject) => socket.once("error", reject).once("close", () => reject(new Error("closed"))));
      closed.catch(() => undefined);
      await Promise.race([new Conversation(socket).reply(), closed]);
      socket.write("QUIT\r\n");
      return true;
    } finally {
      socket.destroy();
    }
  } catch {
    return false;
  }
}
