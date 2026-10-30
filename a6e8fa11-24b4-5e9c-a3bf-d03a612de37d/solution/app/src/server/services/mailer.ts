// A minimal SMTP client for the mail sink: EHLO, MAIL FROM, RCPT TO, DATA, QUIT, plain-text UTF-8 bodies.
import { randomUUID } from "node:crypto";
import { Socket, connect } from "node:net";
import { type Config } from "../config.js";

interface Message {
  to: string;
  subject: string;
  body: string;
}

class Conversation {
  private buffer = "";
  private waiting: Array<(line: string) => void> = [];
  private failed: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        // A reply ends at a line whose code is followed by a space ("250 OK"), not a dash ("250-SIZE").
        const m = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(this.buffer);
        if (!m) break;
        const end = m.index + m[0].length;
        const reply = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end);
        this.waiting.shift()?.(reply);
      }
    });
    const fail = (error: Error): void => {
      this.failed = error;
      for (const w of this.waiting.splice(0)) w("");
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("closed")));
  }

  reply(): Promise<string> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) =>
      this.waiting.push((line) => (line ? resolve(line) : reject(this.failed ?? new Error("closed")))),
    );
  }

  async expect(code: string, command?: string): Promise<void> {
    const pending = this.reply();
    if (command !== undefined) this.socket.write(`${command}\r\n`);
    const line = await pending;
    if (!line.trimStart().startsWith(code)) throw new Error(`SMTP ${line.trim()}`);
  }
}

function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from.trim();
}

function encodeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function encodeFrom(from: string): string {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m && m[1] ? `${encodeHeader(m[1])} <${m[2]}>` : from;
}

export class Mailer {
  constructor(private readonly cfg: Config["smtp"]) {}

  private open(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.cfg.host, port: this.cfg.port });
      socket.setTimeout(8000, () => socket.destroy(new Error("timeout")));
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
  }

  async send(message: Message): Promise<void> {
    const socket = await this.open();
    const smtp = new Conversation(socket);
    try {
      await smtp.expect("220");
      await smtp.expect("250", "EHLO furrowbook.local");
      await smtp.expect("250", `MAIL FROM:<${addressOf(this.cfg.from)}>`);
      await smtp.expect("250", `RCPT TO:<${message.to}>`);
      await smtp.expect("354", "DATA");
      const body = Buffer.from(message.body, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
      const data = [
        `From: ${encodeFrom(this.cfg.from)}`,
        `To: <${message.to}>`,
        `Subject: ${encodeHeader(message.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${randomUUID()}@furrowbook.local>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        body,
        ".",
      ].join("\r\n");
      await smtp.expect("250", data);
      await smtp.expect("221", "QUIT").catch(() => undefined);
    } finally {
      socket.destroy();
    }
  }

  /** True when the sink greets us. */
  async reachable(): Promise<boolean> {
    try {
      const socket = await this.open();
      const smtp = new Conversation(socket);
      try {
        await smtp.expect("220");
        await smtp.expect("221", "QUIT").catch(() => undefined);
        return true;
      } finally {
        socket.destroy();
      }
    } catch {
      return false;
    }
  }
}
