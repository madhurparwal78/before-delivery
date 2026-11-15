import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config";
import { MailUnavailable } from "./errors";

const timeoutMs = 4000;

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

function envelopeAddress(address: string): string {
  return /<([^>]+)>/.exec(address)?.[1] ?? address.trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

class SmtpSession {
  private buffer = "";
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failure: Error | null = null;
  private failed: ((error: Error) => void) | null = null;

  private constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    const fail = (error: Error) => {
      this.failure = error;
      this.failed?.(error);
    };
    socket.on("error", fail);
    socket.on("timeout", () => fail(new Error("smtp timeout")));
    socket.on("close", () => fail(new Error("smtp connection closed")));
  }

  static open(): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => resolve(new SmtpSession(socket)));
      socket.once("error", reject);
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("smtp connect timeout"));
      });
    });
  }

  private drain(): void {
    const lines = this.buffer.split("\r\n");
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] ?? "";
      if (/^\d{3} /.test(line) && this.waiting) {
        this.buffer = lines.slice(index + 1).join("\r\n");
        const resolve = this.waiting;
        this.waiting = null;
        resolve({ code: Number(line.slice(0, 3)), text: line });
        return;
      }
    }
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.failed = reject;
      this.waiting = resolve;
      this.drain();
    });
  }

  async command(line: string, expected: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    const answer = await this.reply();
    if (answer.code !== expected) throw new Error(`smtp ${line.split(" ")[0]} answered ${answer.text}`);
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }
}

export async function sendMail(message: MailMessage): Promise<void> {
  let session: SmtpSession | null = null;
  try {
    session = await SmtpSession.open();
    const greeting = await session.reply();
    if (greeting.code !== 220) throw new Error(`smtp greeting ${greeting.text}`);
    await session.command("EHLO ashlar.local", 250);
    await session.command(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, 250);
    await session.command(`RCPT TO:<${envelopeAddress(message.to)}>`, 250);
    await session.command("DATA", 354);
    const fromDomain = envelopeAddress(config.mailFrom).split("@")[1] ?? "ashlar.local";
    const headers = [
      `From: ${config.mailFrom}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
      `Message-ID: <${randomUUID()}@${fromDomain}>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
    ];
    const body = message.body
      .replace(/\r?\n/g, "\r\n")
      .split("\r\n")
      .map((line) => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    await session.command(`${headers.join("\r\n")}\r\n\r\n${body}\r\n.`, 250);
    await session.command("QUIT", 221).catch(() => undefined);
  } catch (error) {
    throw new MailUnavailable(error instanceof Error ? error.message : "mail failed");
  } finally {
    session?.close();
  }
}

export async function mailReachable(): Promise<boolean> {
  try {
    const session = await SmtpSession.open();
    try {
      const greeting = await session.reply();
      return greeting.code === 220;
    } finally {
      session.close();
    }
  } catch {
    return false;
  }
}
