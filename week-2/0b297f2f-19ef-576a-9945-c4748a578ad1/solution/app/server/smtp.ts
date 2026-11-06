// A minimal SMTP client for the mail relay: plain SMTP, one message per connection.
import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";

const TIMEOUT_MS = 6000;

interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

class Session {
  private buffer = "";
  private waiting: ((line: { code: number; text: string }) => void) | null = null;
  private failure: Error | null = null;
  private failed: ((error: Error) => void) | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    const fail = (error: Error) => {
      this.failure ??= error;
      this.failed?.(this.failure);
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("mail relay closed the connection")));
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("mail relay timeout")));
  }

  private drain(): void {
    // A complete reply ends with a line "NNN text" (a space after the code, not a hyphen).
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
        const reply = { code: Number(lines[i].slice(0, 3)), text: lines.slice(0, i + 1).join("\n") };
        this.buffer = lines.slice(i + 1).join("\r\n");
        const resolve = this.waiting;
        this.waiting = null;
        resolve?.(reply);
        return;
      }
    }
  }

  reply(expect: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.failed = reject;
      this.waiting = (line) => {
        this.failed = null;
        if (Math.floor(line.code / 100) === Math.floor(expect / 100)) resolve();
        else reject(new Error(`mail relay answered ${line.text}`));
      };
      this.drain();
    });
  }

  async command(line: string, expect: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.reply(expect);
  }
}

function connect(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("mail relay timeout")));
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1] : value).trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeFrom(value: string): string {
  const match = /^(.*)<([^>]+)>\s*$/.exec(value);
  if (!match) return value;
  const name = match[1].trim().replace(/^"|"$/g, "");
  return `${/^[\w .-]*$/.test(name) ? name : encodeHeader(name)} <${match[2]}>`;
}

function base64Lines(text: string): string {
  return (Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function compose(message: Message): string {
  const boundary = `hangline-${randomUUID()}`;
  const domain = address(config.mailFrom).split("@")[1] ?? "localhost";
  return [
    `From: ${encodeFrom(config.mailFrom)}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Sends one message; resolves once the relay has accepted it. */
export async function sendMail(message: Message): Promise<void> {
  const socket = await connect();
  const session = new Session(socket);
  try {
    await session.reply(220);
    await session.command("EHLO hangline", 250);
    await session.command(`MAIL FROM:<${address(config.mailFrom)}>`, 250);
    await session.command(`RCPT TO:<${address(message.to)}>`, 250);
    await session.command("DATA", 354);
    await session.command(`${compose(message)}\r\n.`, 250);
    await session.command("QUIT", 221).catch(() => undefined);
  } finally {
    socket.destroy();
  }
}

/** Status probe: the relay accepts a connection and greets. */
export async function probeRelay(): Promise<boolean> {
  try {
    const socket = await connect();
    const session = new Session(socket);
    try {
      await session.reply(220);
      await session.command("QUIT", 221).catch(() => undefined);
      return true;
    } finally {
      socket.destroy();
    }
  } catch {
    return false;
  }
}
