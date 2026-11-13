// Mail over plain SMTP: one message per call, accepted only when the server answers 250 to DATA.
import { connect, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import { ProviderError } from "./providerError.js";

const TIMEOUT_MS = 10_000;

interface Attachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

interface Message {
  to: string[];
  subject: string;
  text: string;
  attachments: Attachment[];
}

/** A line-oriented SMTP conversation over one socket. */
class Conversation {
  private buffer = "";
  private waiting: ((reply: string) => void) | null = null;
  private failed: Error | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("connection closed")));
    socket.setTimeout(TIMEOUT_MS, () => {
      this.fail(new Error("timed out"));
      socket.destroy();
    });
  }

  static open(host: string, port: number): Promise<Conversation> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      socket.once("connect", () => resolve(new Conversation(socket)));
      socket.once("error", reject);
      socket.setTimeout(TIMEOUT_MS, () => {
        socket.destroy();
        reject(new Error("connect timed out"));
      });
    });
  }

  private fail(error: Error): void {
    this.failed ??= error;
    this.deliver();
  }

  /** Hands over one complete reply (the last line of a multi-line reply has a space after its code). */
  private deliver(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split("\r\n");
    const end = lines.findIndex((line) => /^\d{3} /.test(line));
    if (end === -1) {
      if (this.failed) {
        const settle = this.waiting;
        this.waiting = null;
        settle(`000 ${this.failed.message}`);
      }
      return;
    }
    const reply = lines.slice(0, end + 1).join("\n");
    this.buffer = lines.slice(end + 1).join("\r\n");
    const resolve = this.waiting;
    this.waiting = null;
    resolve(reply);
  }

  reply(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.deliver();
    });
  }

  async expect(command: string | null, code: string): Promise<void> {
    if (command !== null) this.socket.write(`${command}\r\n`);
    const reply = await this.reply();
    if (!reply.split("\n").pop()?.startsWith(code)) throw new ProviderError(`SMTP ${command ?? "greeting"}: ${reply}`);
  }

  close(): void {
    this.socket.end("QUIT\r\n");
  }
}

const wrap64 = (data: Buffer): string => (data.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

/** RFC 2047 encoded-word for any header text outside printable ASCII. */
const headerText = (text: string): string =>
  /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;

function compose(from: string, message: Message): string {
  const textPart = message.text.replace(/\r?\n/g, "\r\n");
  const head = [
    `From: ${from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${headerText(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@slackwater>`,
    "MIME-Version: 1.0",
  ];
  if (message.attachments.length === 0) {
    return [...head, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", textPart].join("\r\n");
  }
  const boundary = `slackwater-${randomUUID()}`;
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${textPart}`,
    ...message.attachments.map(
      (a) =>
        `--${boundary}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${a.filename}"\r\n\r\n${wrap64(a.data)}`,
    ),
  ];
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts, `--${boundary}--`].join("\r\n");
}

export class Mailer {
  constructor(private readonly config: Config["smtp"]) {}

  async reachable(): Promise<boolean> {
    if (!this.config.host || !this.config.port) return false;
    try {
      const smtp = await Conversation.open(this.config.host, this.config.port);
      try {
        await smtp.expect(null, "220");
        return true;
      } finally {
        smtp.close();
      }
    } catch {
      return false;
    }
  }

  /** Resolves only once the server has accepted the message for delivery. */
  async send(message: Message): Promise<void> {
    if (!this.config.host || !this.config.port) throw new ProviderError("SMTP_HOST or SMTP_PORT is not set");
    const from = this.config.from;
    const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
    let smtp: Conversation;
    try {
      smtp = await Conversation.open(this.config.host, this.config.port);
    } catch (error) {
      throw new ProviderError(`SMTP connect: ${String(error)}`);
    }
    try {
      await smtp.expect(null, "220");
      await smtp.expect("EHLO slackwater", "250");
      await smtp.expect(`MAIL FROM:<${address}>`, "250");
      for (const to of message.to) await smtp.expect(`RCPT TO:<${to}>`, "250");
      await smtp.expect("DATA", "354");
      const data = compose(from, message).replace(/^\./gm, "..");
      await smtp.expect(`${data}\r\n.`, "250");
    } finally {
      smtp.close();
    }
  }
}
