/** A minimal SMTP submission client: connect, hand over one message, quit. */

import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";

export interface SmtpTarget {
  host: string;
  port: number;
  timeoutMs: number;
}

export interface Message {
  from: string;
  to: string;
  subject: string;
  body: string;
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = "";
  private pending: {
    resolve: (reply: { code: number; text: string }) => void;
    reject: (error: Error) => void;
  } | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    const fail = (error: Error): void => {
      this.failure = error;
      this.pending?.reject(error);
      this.pending = null;
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("The mail server closed the connection")));
    socket.on("timeout", () => {
      socket.destroy();
      fail(new Error("The mail server did not answer in time"));
    });
  }

  private drain(): void {
    if (!this.pending) return;
    const lines = this.buffer.split("\r\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.length < 4) continue;
      // A reply is complete when a line has a space after its three-digit code.
      if (line[3] === " ") {
        const consumed = lines.slice(0, index + 1).join("\r\n").length + 2;
        const text = lines.slice(0, index + 1).join("\n");
        this.buffer = this.buffer.slice(consumed);
        const waiting = this.pending;
        this.pending = null;
        waiting?.resolve({ code: Number(line.slice(0, 3)), text });
        return;
      }
    }
  }

  reply(): Promise<{ code: number; text: string }> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.drain();
    });
  }

  async command(line: string, expected: number[]): Promise<void> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.reply();
    if (!expected.includes(reply.code)) {
      throw new Error(`SMTP ${line.split(" ")[0]} was refused: ${reply.text}`);
    }
  }

  write(payload: string): void {
    this.socket.write(payload);
  }

  end(): void {
    this.socket.destroy();
  }
}

function connect(target: SmtpTarget): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: target.host, port: target.port });
    socket.setTimeout(target.timeoutMs);
    socket.once("connect", () => resolve(new SmtpSession(socket)));
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("The mail server did not accept a connection in time"));
    });
  });
}

function bareAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  return (angled ? angled[1] : value).trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrap(value: string): string {
  return value.replace(/(.{1,76})/g, "$1\r\n");
}

function render(message: Message): string {
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@spanwise>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const body = wrap(Buffer.from(message.body, "utf8").toString("base64"));
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n.\r\n`;
}

/** Hands one message to the mail server, resolving only once it accepts it. */
export async function deliver(target: SmtpTarget, message: Message): Promise<void> {
  const session = await connect(target);
  try {
    const greeting = await session.reply();
    if (greeting.code !== 220) throw new Error(`The mail server refused us: ${greeting.text}`);
    await session.command("EHLO spanwise", [250]);
    await session.command(`MAIL FROM:<${bareAddress(message.from)}>`, [250]);
    await session.command(`RCPT TO:<${bareAddress(message.to)}>`, [250, 251]);
    await session.command("DATA", [354]);
    session.write(render(message));
    const accepted = await session.reply();
    if (accepted.code !== 250) throw new Error(`The mail server rejected the message: ${accepted.text}`);
    session.write("QUIT\r\n");
  } finally {
    session.end();
  }
}

/** True when the mail server answers a greeting and EHLO. */
export async function reachable(target: SmtpTarget): Promise<boolean> {
  try {
    const session = await connect(target);
    try {
      const greeting = await session.reply();
      if (greeting.code !== 220) return false;
      await session.command("EHLO spanwise", [250]);
      session.write("QUIT\r\n");
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
}
