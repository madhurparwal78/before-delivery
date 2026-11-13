import net from "node:net";
import { config } from "./config";

const TIMEOUT_MS = 5000;

interface Reply {
  code: number;
  text: string;
}

class SmtpSession {
  private buffer = "";
  private readonly replies: Reply[] = [];
  private waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;
  private failed: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.feed(chunk));
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("smtp connection closed")));
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("smtp timeout")));
  }

  private fail(error: Error): void {
    this.failed ??= error;
    this.waiting?.reject(error);
    this.waiting = null;
  }

  /** A reply ends at the first line whose code is followed by a space. */
  private feed(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const lines = this.buffer.split("\r\n");
      const end = lines.findIndex((line, index) => index < lines.length - 1 && /^\d{3} /.test(line));
      if (end < 0) return;
      const reply = { code: Number((lines[end] ?? "").slice(0, 3)), text: lines.slice(0, end + 1).join("\n") };
      this.buffer = lines.slice(end + 1).join("\r\n");
      const waiter = this.waiting;
      if (waiter) {
        this.waiting = null;
        waiter.resolve(reply);
      } else {
        this.replies.push(reply);
      }
    }
  }

  reply(): Promise<Reply> {
    const ready = this.replies.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  async command(line: string, expected: number): Promise<void> {
    const pending = this.reply();
    this.socket.write(`${line}\r\n`);
    const { code, text } = await pending;
    if (code !== expected) throw new Error(`smtp ${line.split(" ")[0]} answered ${text}`);
  }

  async greeting(): Promise<void> {
    const { code } = await this.reply();
    if (code !== 220) throw new Error("smtp greeting refused");
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("smtp connect timeout")));
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      const session = new SmtpSession(socket);
      resolve(session);
    });
  });
}

/** True when the server answers with a greeting. */
export async function smtpReachable(): Promise<boolean> {
  try {
    const session = await Promise.race([
      connect(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("smtp connect timeout")), 1500)),
    ]);
    try {
      await Promise.race([session.greeting(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("greeting timeout")), 1500))]);
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
}

const encodeHeader = (text: string): string => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`);

interface Mail {
  to: string;
  subject: string;
  text: string;
  messageId: string;
}

const addressOf = (from: string): string => (from.includes("<") ? from.slice(from.indexOf("<") + 1, from.indexOf(">")) : from.trim());

/** Sends one plain-text message; resolves when the server accepted it, rejects otherwise. */
export async function sendMail(mail: Mail): Promise<void> {
  const session = await connect();
  try {
    await session.greeting();
    await session.command("EHLO gatecut", 250);
    await session.command(`MAIL FROM:<${addressOf(config.mailFrom)}>`, 250);
    await session.command(`RCPT TO:<${mail.to}>`, 250);
    await session.command("DATA", 354);
    const body = Buffer.from(mail.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
    const message = [
      `From: ${config.mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${mail.messageId}@gatecut>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
      ".",
    ].join("\r\n");
    await session.command(message, 250);
    await session.command("QUIT", 221).catch(() => undefined);
  } finally {
    session.end();
  }
}
