// Plain-text email over SMTP. Each send opens a fresh connection and keeps no remembered failure.
import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "./config.ts";

interface Message {
  to: string;
  subject: string;
  text: string;
}

/** The header-safe rule: each run of line breaks, tabs or other control characters becomes one space. */
export function headerSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ");
}

function encodeWords(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`).join("\r\n ");
}

function quotedPrintable(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => {
      let out = "";
      let width = 0;
      const bytes = Buffer.from(line, "utf8");
      bytes.forEach((byte, index) => {
        const last = index === bytes.length - 1;
        const plain = (byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && !last);
        const piece = plain ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
        if (width + piece.length > 75) {
          out += "=\r\n";
          width = 0;
        }
        out += piece;
        width += piece.length;
      });
      return out;
    })
    .join("\r\n");
}

function address(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return (match?.[1] ?? mailbox).trim();
}

function compose(message: Message): string {
  const from = headerSafe(config.mailFrom);
  const lines = [
    `From: ${from}`,
    `To: <${message.to}>`,
    `Subject: ${encodeWords(headerSafe(message.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${address(from).split("@")[1] ?? "marginalia.test"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    quotedPrintable(message.text),
  ];
  return lines.join("\r\n").replace(/^\./gm, "..");
}

/** One open SMTP session: the greeting and EHLO have been answered. */
export class MailConnection {
  private buffer = "";
  private waiting: ((line: string | Error) => void) | null = null;
  private failure: Error | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setTimeout(8000, () => this.fail(new Error("mail timeout")));
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("mail connection closed")));
    socket.on("data", (data) => {
      this.buffer += data.toString("utf8");
      this.drain();
    });
  }

  /** Open a fresh connection; rejects when the mail service is unreachable. */
  static async open(): Promise<MailConnection> {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    const connection = new MailConnection(socket);
    try {
      await connection.step(null, 220);
      await connection.step("EHLO marginalia.local", 250);
    } catch (error) {
      connection.close();
      throw error;
    }
    return connection;
  }

  /** Deliver one message over this connection; rejects when the service refuses it. */
  async send(message: Message): Promise<void> {
    await this.step(`MAIL FROM:<${address(config.mailFrom)}>`, 250);
    await this.step(`RCPT TO:<${message.to}>`, 250);
    await this.step("DATA", 354);
    await this.step(`${compose(message)}\r\n.`, 250);
  }

  close(): void {
    if (!this.socket.destroyed) this.socket.end("QUIT\r\n");
    this.socket.destroy();
  }

  private fail(error: Error): void {
    this.failure ??= error;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.(error);
  }

  private drain(): void {
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end < 0 || !this.waiting) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      if (line[3] === "-") continue;
      const waiting = this.waiting;
      this.waiting = null;
      waiting(line);
    }
  }

  private step(command: string | null, expect: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.waiting = (line) => {
        if (line instanceof Error) reject(line);
        else if (Number(line.slice(0, 3)) !== expect) reject(new Error(`mail refused: ${line.slice(0, 3)}`));
        else resolve();
      };
      if (command !== null) this.socket.write(`${command}\r\n`);
      this.drain();
    });
  }
}

/** Deliver one message on a fresh connection; rejects when the mail service is unreachable or refuses it. */
export async function sendMail(message: Message): Promise<void> {
  const connection = await MailConnection.open();
  try {
    await connection.send(message);
  } finally {
    connection.close();
  }
}
