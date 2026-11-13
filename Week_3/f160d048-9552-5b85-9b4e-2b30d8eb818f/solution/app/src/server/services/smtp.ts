import net from "node:net";
import { config } from "../config";

const STEP_MS = 8000;

class SmtpSession {
  private buffer = "";
  private waiting: ((reply: string) => void) | undefined;
  private failure: ((error: Error) => void) | undefined;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on("error", (error) => this.failure?.(error));
    socket.on("close", () => this.failure?.(new Error("smtp connection closed")));
  }

  private deliver(): void {
    const lines = this.buffer.split("\r\n");
    const complete = lines.slice(0, -1);
    const last = complete[complete.length - 1];
    if (last !== undefined && /^\d{3} /.test(last) && this.waiting) {
      this.buffer = lines[lines.length - 1] ?? "";
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve(complete.join("\r\n"));
    }
  }

  reply(expected: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("smtp timed out")), STEP_MS);
      this.failure = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.waiting = (text) => {
        clearTimeout(timer);
        if (text.split("\r\n").pop()?.startsWith(expected)) resolve();
        else reject(new Error(`smtp answered ${text.slice(0, 80)}`));
      };
      this.deliver();
    });
  }

  async command(line: string, expected: string): Promise<void> {
    const answer = this.reply(expected);
    this.socket.write(`${line}\r\n`);
    await answer;
  }
}

function connect(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.mail.host, port: config.mail.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("smtp connect timed out"));
    }, STEP_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function smtpReachable(): Promise<boolean> {
  try {
    const socket = await connect();
    const session = new SmtpSession(socket);
    await session.reply("220");
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

const bareAddress = (from: string): string => (from.includes("<") ? from.slice(from.indexOf("<") + 1, from.indexOf(">")) : from.trim());

function wrapBase64(text: string): string {
  return (Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const socket = await connect();
  try {
    const session = new SmtpSession(socket);
    await session.reply("220");
    await session.command("EHLO candour-bench", "250");
    await session.command(`MAIL FROM:<${bareAddress(config.mail.from)}>`, "250");
    await session.command(`RCPT TO:<${to}>`, "250");
    await session.command("DATA", "354");
    const message = [
      `From: ${config.mail.from}`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(body),
    ].join("\r\n");
    await session.command(`${message}\r\n.`, "250");
    await session.command("QUIT", "221").catch(() => undefined);
  } finally {
    socket.destroy();
  }
}

export async function inboxReachable(): Promise<boolean> {
  try {
    return (await fetch(`${config.mail.inboxUrl}/readyz`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}
