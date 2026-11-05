import { createConnection, type Socket } from "node:net";
import { config } from "../config.js";

export interface OutgoingMessage {
  to: string;
  subject: string;
  body: string;
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (error: Error) => {
      this.failure = error;
      this.flush();
    });
  }

  private flush(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    if (this.failure) {
      this.waiting = null;
      waiting(`421 ${this.failure.message}`);
      return;
    }
    const lines = this.buffer.split("\r\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (/^\d{3} /.test(line)) {
        this.buffer = lines.slice(index + 1).join("\r\n");
        this.waiting = null;
        waiting(line);
        return;
      }
    }
  }

  read(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.flush();
    });
  }

  async command(text: string, expected: string): Promise<void> {
    this.socket.write(`${text}\r\n`);
    const code = await this.read();
    if (!code.startsWith(expected)) throw new Error(`smtp refused ${text.split(" ")[0]}: ${code}`);
  }

  write(text: string): void {
    this.socket.write(text);
  }

  end(): void {
    this.socket.end();
  }
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match?.[1] ?? config.mail.from;
}

export async function sendMessage(message: OutgoingMessage): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const created = createConnection({ host: config.mail.host, port: config.mail.port, timeout: 10_000 });
    created.once("connect", () => resolve(created));
    created.once("error", reject);
    created.once("timeout", () => reject(new Error("smtp connection timed out")));
  });
  const session = new SmtpSession(socket);
  try {
    const greeting = await session.read();
    if (!greeting.startsWith("220")) throw new Error(`smtp greeting ${greeting}`);
    await session.command("EHLO pampero-ledger", "250");
    await session.command(`MAIL FROM:<${senderAddress()}>`, "250");
    await session.command(`RCPT TO:<${message.to}>`, "250");
    await session.command("DATA", "354");
    const headers = [
      `From: ${config.mail.from}`,
      `To: <${message.to}>`,
      `Subject: ${encodeHeader(message.subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      `Date: ${new Date().toUTCString()}`,
    ].join("\r\n");
    const encoded = Buffer.from(message.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
    session.write(`${headers}\r\n\r\n${encoded}\r\n.\r\n`);
    const accepted = await session.read();
    if (!accepted.startsWith("250")) throw new Error(`smtp refused the message: ${accepted}`);
    await session.command("QUIT", "221");
  } finally {
    session.end();
  }
}

export async function reachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port, timeout: 1500 });
    const finish = (value: boolean): void => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}
