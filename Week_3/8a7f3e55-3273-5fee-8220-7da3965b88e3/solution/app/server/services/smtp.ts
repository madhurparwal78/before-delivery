import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "../config.js";

const TIMEOUT_MS = 10_000;

export interface Message {
  to: string;
  subject: string;
  body: string;
}

function addressOf(mailbox: string): string {
  const open = mailbox.indexOf("<");
  return open === -1 ? mailbox.trim() : mailbox.slice(open + 1, mailbox.indexOf(">"));
}

function wrapBase64(text: string): string {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  return (encoded.match(/.{1,76}/g) ?? []).join("\r\n");
}

function render(message: Message): string {
  const sender = addressOf(config.mailFrom);
  const domain = sender.slice(sender.indexOf("@") + 1);
  const headers = [
    `From: ${config.mailFrom}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${wrapBase64(message.body)}\r\n`;
}

class Conversation {
  private buffer = "";
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("connection closed")));
    socket.setTimeout(TIMEOUT_MS, () => this.fail(new Error("timed out")));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.deliver();
  }

  private deliver(): void {
    if (!this.waiting) return;
    if (this.failure && !/\r?\n/.test(this.buffer)) {
      const waiting = this.waiting;
      this.waiting = null;
      waiting({ code: 0, text: this.failure.message });
      return;
    }
    const lines = this.buffer.split(/\r?\n/);
    const last = lines.findIndex((line) => /^\d{3} /.test(line));
    if (last === -1) return;
    this.buffer = lines.slice(last + 1).join("\n");
    const waiting = this.waiting;
    this.waiting = null;
    waiting({ code: Number(lines[last]?.slice(0, 3)), text: lines.slice(0, last + 1).join("\n") });
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.deliver();
    });
  }

  async expect(codes: number[]): Promise<void> {
    const reply = await this.reply();
    if (!codes.includes(reply.code)) throw new Error(`SMTP ${reply.code || "failure"}: ${reply.text}`);
  }

  async command(line: string, codes: number[]): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(codes);
  }
}

/** Sends one plain-text message through the configured SMTP server; rejects when it cannot. */
export async function sendMail(message: Message): Promise<void> {
  const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const talk = new Conversation(socket);
  try {
    await talk.expect([220]);
    await talk.command("EHLO relayline", [250]);
    await talk.command(`MAIL FROM:<${addressOf(config.mailFrom)}>`, [250]);
    await talk.command(`RCPT TO:<${message.to}>`, [250, 251]);
    await talk.command("DATA", [354]);
    const stuffed = render(message).replace(/^\./gm, "..");
    await talk.command(`${stuffed}.`, [250]);
    await talk.command("QUIT", [221]).catch(() => undefined);
  } finally {
    socket.destroy();
  }
}
