import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { reach } from "./services.js";

// Plain SMTP without authentication, one recipient per message. A message is staged (envelope and
// content written, final dot withheld) and then accepted or abandoned, so the server's acceptance
// is the last step of a confirm or cancel unit.

const SENDER = "no-reply@pilotlight.test";
const FROM = `Pilotlight <${SENDER}>`;

export interface Message {
  to: string;
  subject: string;
  text: string;
}

class SmtpError extends Error {}

class SmtpSession {
  private buffer = "";
  private waiting: ((reply: string) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;

  private constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on("error", (error) => this.failed?.(error));
    socket.on("close", () => this.failed?.(new SmtpError("connection closed")));
  }

  static open(): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
      socket.setTimeout(10_000, () => socket.destroy(new SmtpError("timeout")));
      socket.once("connect", () => resolve(new SmtpSession(socket)));
      socket.once("error", reject);
    });
  }

  private deliver(): void {
    const lines = this.buffer.split("\r\n");
    const last = lines.findIndex((line) => /^\d{3} /.test(line));
    if (last < 0 || !this.waiting) return;
    const reply = lines.slice(0, last + 1).join("\n");
    this.buffer = lines.slice(last + 1).join("\r\n");
    const resolve = this.waiting;
    this.waiting = null;
    this.failed = null;
    resolve(reply);
  }

  /** Writes a line (or nothing) and waits for a reply with the expected code. */
  expect(code: string, line?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiting = (reply) => (reply.split("\n").at(-1)?.startsWith(code) ? resolve(reply) : reject(new SmtpError(reply)));
      this.failed = reject;
      if (line !== undefined) this.socket.write(`${line}\r\n`);
      this.deliver();
    });
  }

  write(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.destroy();
  }

  /** Sends the final dot; the message counts as delivered once SMTP answers 250. */
  accept(): Promise<void> {
    return reach("mail", async () => {
      try {
        await this.expect("250", "\r\n.");
        this.write("QUIT\r\n");
      } finally {
        this.close();
      }
    });
  }

  /** Drops the connection before the final dot, so nothing is delivered. */
  abandon(): void {
    this.close();
  }
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function content(message: Message): string {
  const body = Buffer.from(message.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${FROM}`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@pilotlight.test>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Opens a session and writes the whole message except its terminating dot. */
export async function stage(message: Message): Promise<SmtpSession> {
  return reach("mail", async () => {
    const opened = await SmtpSession.open();
    try {
      await opened.expect("220");
      await opened.expect("250", "EHLO pilotlight.test");
      await opened.expect("250", `MAIL FROM:<${SENDER}>`);
      await opened.expect("250", `RCPT TO:<${message.to}>`);
      await opened.expect("354", "DATA");
      opened.write(`${content(message).replace(/^\./gm, "..")}`);
      return opened;
    } catch (error) {
      opened.close();
      throw error;
    }
  });
}

export async function send(message: Message): Promise<void> {
  const staged = await stage(message);
  await staged.accept();
}

export async function probe(): Promise<void> {
  const session = await SmtpSession.open();
  try {
    await session.expect("220");
    await session.expect("221", "QUIT");
  } finally {
    session.close();
  }
}
