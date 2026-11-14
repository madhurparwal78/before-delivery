import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";

const SEND_TIMEOUT_MS = 10000;
const PROBE_TIMEOUT_MS = 2000;

/** Reads SMTP replies one at a time from a socket. */
class SmtpConnection {
  private buffer = "";
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failure: Error | null = null;
  private failed: ((error: Error) => void) | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    const onError = (error: Error) => {
      this.failure = error;
      this.failed?.(error);
    };
    socket.on("error", onError);
    socket.on("close", () => onError(new Error("SMTP connection closed")));
  }

  private flush(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]!;
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const text = lines.slice(0, i + 1).join("\n");
        this.buffer = lines.slice(i + 1).join("\r\n");
        const resolve = this.waiting;
        this.waiting = null;
        this.failed = null;
        resolve({ code: Number(line.slice(0, 3)), text });
        return;
      }
    }
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.waiting = resolve;
      this.failed = reject;
      this.flush();
    });
  }

  async command(line: string, expected: number[]): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(expected);
  }

  async expect(expected: number[]): Promise<void> {
    const reply = await this.reply();
    if (!expected.includes(reply.code)) throw new Error(`SMTP replied ${reply.text}`);
  }

  write(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.destroy();
  }
}

function connect(timeoutMs: number): Promise<SmtpConnection> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("SMTP timeout")));
    socket.once("connect", () => resolve(new SmtpConnection(socket)));
    socket.once("error", reject);
  });
}

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1]! : value).trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeFrom(value: string): string {
  const match = /^(.*)<([^>]+)>\s*$/.exec(value);
  if (!match) return value;
  return `${encodeHeader(match[1]!.trim())} <${match[2]}>`;
}

export interface Email {
  to: string;
  subject: string;
  lines: string[];
}

/** Sends an email; resolves only after the SMTP server has accepted the message. */
export async function sendMail(email: Email): Promise<void> {
  const connection = await connect(SEND_TIMEOUT_MS);
  try {
    await connection.expect([220]);
    await connection.command("EHLO joinery.local", [250]);
    await connection.command(`MAIL FROM:<${address(config.mailFrom)}>`, [250]);
    await connection.command(`RCPT TO:<${address(email.to)}>`, [250, 251]);
    await connection.command("DATA", [354]);
    const domain = address(config.mailFrom).split("@")[1] ?? "joinery.local";
    const headers = [
      `From: ${encodeFrom(config.mailFrom)}`,
      `To: ${email.to}`,
      `Subject: ${encodeHeader(email.subject)}`,
      `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
      `Message-ID: <${randomUUID()}@${domain}>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
    ];
    const body = email.lines.map((line) => (line.startsWith(".") ? `.${line}` : line));
    connection.write(`${[...headers, "", ...body].join("\r\n")}\r\n.\r\n`);
    await connection.expect([250]);
    await connection.command("QUIT", [221]).catch(() => undefined);
  } finally {
    connection.close();
  }
}

export async function probeMail(): Promise<boolean> {
  try {
    const connection = await connect(PROBE_TIMEOUT_MS);
    try {
      await connection.expect([220]);
      await connection.command("QUIT", [221]).catch(() => undefined);
      return true;
    } finally {
      connection.close();
    }
  } catch {
    return false;
  }
}
