// Mailpit over plain SMTP: one message per call, accepted or refused, and the health check.
// The outbox (claiming a notice and marking it sent) is in notices.ts.

import { connect, type Socket } from "node:net";
import { config } from "./config.ts";
import { reportService } from "./status.ts";

const TIMEOUT_MS = 8_000;

interface Outgoing {
  noticeId: string;
  to: string;
  subject: string;
  body: string;
}

/** The address inside MAIL_FROM ("Name <address>" or a bare address). */
function envelopeAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

function encodeFrom(value: string): string {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(value.trim());
  return match ? `${encodeHeader(match[1] as string)} <${match[2]}>` : value.trim();
}

function message(outgoing: Outgoing): string {
  const body = Buffer.from(outgoing.body, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${encodeFrom(config.mail.from)}`,
    `To: ${outgoing.to}`,
    `Subject: ${encodeHeader(outgoing.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `X-Nightplan-Notice: ${outgoing.noticeId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** A minimal SMTP conversation: one reply per command, multi-line replies joined. */
class Conversation {
  private buffer = "";
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failure: Error | null = null;
  private failed: ((error: Error) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.setTimeout(TIMEOUT_MS, () => this.fail(new Error("SMTP timed out")));
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("SMTP connection closed")));
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.failed?.(error);
    this.socket.destroy();
  }

  private drain(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split("\r\n");
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] as string;
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        this.buffer = lines.slice(index + 1).join("\r\n");
        const resolve = this.waiting;
        this.waiting = null;
        resolve?.({ code: Number(line.slice(0, 3)), text: line });
        return;
      }
    }
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.waiting = resolve;
      this.failed = reject;
      this.drain();
    });
  }

  async command(line: string, expected: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    const answer = await this.reply();
    if (answer.code !== expected) throw new Error(`SMTP refused: ${answer.text}`);
  }

  close(): void {
    this.socket.end();
  }
}

async function open(): Promise<Conversation> {
  const socket = connect({ host: config.mail.host, port: config.mail.port });
  const conversation = new Conversation(socket);
  const greeting = await conversation.reply();
  if (greeting.code !== 220) throw new Error(`SMTP greeting: ${greeting.text}`);
  return conversation;
}

/** Sends one notice; resolves only after the SMTP server accepts the message. */
export async function sendMail(outgoing: Outgoing): Promise<void> {
  const conversation = await open();
  try {
    await conversation.command("EHLO nightplan", 250);
    await conversation.command(`MAIL FROM:<${envelopeAddress(config.mail.from)}>`, 250);
    await conversation.command(`RCPT TO:<${outgoing.to}>`, 250);
    await conversation.command("DATA", 354);
    const stuffed = message(outgoing).replace(/\r\n\./g, "\r\n..");
    await conversation.command(`${stuffed}\r\n.`, 250);
    reportService("mail", true);
    await conversation.command("QUIT", 221).catch(() => undefined);
  } finally {
    conversation.close();
  }
}

/** Health: the SMTP server greets us. Runs at start and every 5 seconds. */
export async function checkMail(): Promise<void> {
  try {
    const conversation = await open();
    await conversation.command("QUIT", 221).catch(() => undefined);
    conversation.close();
    reportService("mail", true);
  } catch {
    reportService("mail", false);
  }
}
