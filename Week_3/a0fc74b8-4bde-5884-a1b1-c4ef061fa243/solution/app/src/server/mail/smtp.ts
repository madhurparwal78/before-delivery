import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "../config.js";
import { MailError } from "../errors.js";

const TIMEOUT_MS = 5000;

export interface Envelope {
  fromAddress: string;
  fromName: string | null;
  to: string;
  subject: string;
  body: string;
}

interface Reply {
  code: number;
  text: string;
}

class Conversation {
  private buffer = "";
  private waiting: ((reply: Reply) => void) | null = null;
  private failure: Error | null = null;
  private lines: string[] = [];

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new MailError("connection closed")));
    socket.setTimeout(TIMEOUT_MS, () => this.fail(new MailError("timed out")));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.waiting?.({ code: 0, text: error.message });
    this.waiting = null;
  }

  private drain(): void {
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      this.lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), text: this.lines.join("\n") };
        this.lines = [];
        const waiting = this.waiting;
        this.waiting = null;
        waiting?.(reply);
        if (!waiting) this.pending = reply;
      }
    }
  }

  private pending: Reply | null = null;

  read(): Promise<Reply> {
    if (this.pending) {
      const reply = this.pending;
      this.pending = null;
      return Promise.resolve(reply);
    }
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = (reply) => (reply.code === 0 ? reject(this.failure ?? new MailError(reply.text)) : resolve(reply));
    });
  }

  async expect(codes: number[]): Promise<void> {
    const reply = await this.read();
    if (!codes.includes(reply.code)) throw new MailError(`unexpected SMTP reply ${reply.text}`);
  }

  async command(line: string, codes: number[]): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(codes);
  }

  write(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.destroy();
  }
}

async function open(): Promise<Conversation> {
  const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
  const conversation = new Conversation(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  await conversation.expect([220]);
  await conversation.command("EHLO undersign.local", [250]);
  return conversation;
}

export async function checkMail(): Promise<boolean> {
  try {
    const conversation = await open();
    conversation.close();
    return true;
  } catch {
    return false;
  }
}

function encodeWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function displayName(name: string): string {
  if (!/^[\x20-\x7e]*$/.test(name)) return encodeWord(name);
  return `"${name.replace(/(["\\])/g, "\\$1")}"`;
}

function formatMessage(envelope: Envelope): string {
  const from = envelope.fromName
    ? `${displayName(envelope.fromName)} <${envelope.fromAddress}>`
    : envelope.fromAddress;
  const domain = envelope.fromAddress.split("@")[1] ?? "undersign.local";
  const body = Buffer.from(envelope.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${from}`,
    `To: <${envelope.to}>`,
    `Subject: ${encodeWord(envelope.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
    "",
  ].join("\r\n");
}

export async function sendMail(envelope: Envelope): Promise<void> {
  let conversation: Conversation;
  try {
    conversation = await open();
  } catch (error) {
    throw error instanceof MailError ? error : new MailError("email is unreachable");
  }
  try {
    await conversation.command(`MAIL FROM:<${envelope.fromAddress}>`, [250]);
    await conversation.command(`RCPT TO:<${envelope.to}>`, [250, 251]);
    await conversation.command("DATA", [354]);
    const data = formatMessage(envelope).replace(/^\./gm, "..");
    conversation.write(`${data}\r\n.\r\n`);
    await conversation.expect([250]);
    await conversation.command("QUIT", [221]).catch(() => undefined);
  } catch (error) {
    throw error instanceof MailError ? error : new MailError("email delivery failed");
  } finally {
    conversation.close();
  }
}
