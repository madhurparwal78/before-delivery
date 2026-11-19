import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "./config.js";
import { mark, unreachable } from "./status.js";

// A plain SMTP client for Mailpit: EHLO, MAIL FROM, RCPT TO, DATA, QUIT, with a 10 s timeout.

const TIMEOUT_MS = 10_000;

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1] : value).trim();
}

function header(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

class Session {
  private buffer = "";
  private waiting: ((reply: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("smtp timeout")));
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.flush();
    });
    socket.on("close", () => {
      this.failure ??= new Error("smtp connection closed");
      this.flush();
    });
  }

  private flush(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split("\r\n");
    const end = lines.findIndex((line) => /^\d{3} /.test(line) || /^\d{3}$/.test(line));
    if (end >= 0) {
      const reply = lines.slice(0, end + 1).join("\n");
      this.buffer = lines.slice(end + 1).join("\r\n");
      const resolve = this.waiting;
      this.waiting = null;
      resolve(reply);
    } else if (this.failure) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve("");
    }
  }

  async expect(code: string, command?: string): Promise<void> {
    const reply = new Promise<string>((resolve) => {
      this.waiting = resolve;
    });
    if (command !== undefined) this.socket.write(`${command}\r\n`);
    this.flush();
    const text = await reply;
    if (!text.startsWith(code)) throw this.failure ?? new Error(`smtp expected ${code}, got ${text.slice(0, 80)}`);
  }

  close(): void {
    this.socket.end();
  }
}

function open(): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port, timeout: TIMEOUT_MS });
    socket.once("connect", () => resolve(new Session(socket)));
    socket.once("error", reject);
    socket.once("timeout", () => socket.destroy(new Error("smtp connect timeout")));
  });
}

function message(to: string, subject: string, body: string): string {
  const encoded = Buffer.from(body, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: <${to}>`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${address(config.smtp.from).split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
  ].join("\r\n");
}

/** Sends one message; a connection failure marks email down and throws. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  let session: Session;
  try {
    session = await open();
  } catch {
    throw unreachable("email");
  }
  try {
    await session.expect("220");
    await session.expect("250", "EHLO dotgain");
    await session.expect("250", `MAIL FROM:<${address(config.smtp.from)}>`);
    await session.expect("250", `RCPT TO:<${to}>`);
    await session.expect("354", "DATA");
    await session.expect("250", `${message(to, subject, body)}\r\n.`);
    mark("email", "up");
    await session.expect("221", "QUIT").catch(() => undefined);
  } catch {
    throw unreachable("email");
  } finally {
    session.close();
  }
}

/** Opens a session and reads the greeting: the email probe. */
export async function probe(): Promise<void> {
  let session: Session;
  try {
    session = await open();
  } catch {
    throw unreachable("email");
  }
  try {
    await session.expect("220");
    mark("email", "up");
    await session.expect("221", "QUIT").catch(() => undefined);
  } catch {
    throw unreachable("email");
  } finally {
    session.close();
  }
}
