import net from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { MailUnavailable } from "./errors.js";

const STEP_TIMEOUT_MS = 5000;

interface Message {
  to: string;
  subject: string;
  text: string;
}

class Conversation {
  private buffer = "";
  private waiting: ((reply: string) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;
  private replies: string[] = [];

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.take(chunk));
    socket.on("error", (error) => this.failure?.(error));
    socket.on("close", () => this.failure?.(new Error("connection closed")));
  }

  private take(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      if (/^\d{3}-/.test(line)) continue;
      this.replies.push(line);
      this.deliver();
    }
  }

  private deliver(): void {
    const next = this.replies.shift();
    if (next !== undefined && this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(next);
    } else if (next !== undefined) {
      this.replies.unshift(next);
    }
  }

  reply(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no reply")), STEP_TIMEOUT_MS);
      this.failure = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.deliver();
    });
  }

  async command(line: string, expect: string): Promise<void> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.reply();
    if (!reply.startsWith(expect)) throw new Error(`unexpected reply to ${line.split(" ")[0]}: ${reply}`);
  }

  raw(data: string): void {
    this.socket.write(data);
  }
}

async function converse<T>(work: (talk: Conversation) => Promise<T>): Promise<T> {
  const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(STEP_TIMEOUT_MS * 3, () => socket.destroy(new Error("timeout")));
  const talk = new Conversation(socket);
  try {
    const greeting = await talk.reply();
    if (!greeting.startsWith("220")) throw new Error(`unexpected greeting: ${greeting}`);
    return await work(talk);
  } catch (error) {
    throw new MailUnavailable(error);
  } finally {
    socket.destroy();
  }
}

export async function mailAnswers(): Promise<boolean> {
  try {
    await converse(async (talk) => talk.command("QUIT", "221"));
    return true;
  } catch {
    return false;
  }
}

function encodeSubject(subject: string): string {
  return /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function envelopeAddress(sender: string): string {
  const open = sender.indexOf("<");
  return open >= 0 ? sender.slice(open + 1, sender.indexOf(">", open)) : sender.trim();
}

export async function sendMail(message: Message): Promise<void> {
  const sender = envelopeAddress(config.smtp.from);
  const body = Buffer.from(message.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const data = [
    `From: ${config.smtp.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeSubject(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${sender.split("@")[1] ?? "ashlar"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
    "",
    ".",
    "",
  ].join("\r\n");
  await converse(async (talk) => {
    await talk.command("EHLO ashlar", "250");
    await talk.command(`MAIL FROM:<${sender}>`, "250");
    await talk.command(`RCPT TO:<${message.to}>`, "250");
    await talk.command("DATA", "354");
    talk.raw(data);
    const accepted = await talk.reply();
    if (!accepted.startsWith("250")) throw new Error(`message refused: ${accepted}`);
    await talk.command("QUIT", "221");
  });
}

export function verificationMessage(handle: string, to: string, token: string): Message {
  return {
    to,
    subject: "Verify your Ashlar account",
    text: `Hi ${handle},\n\nOpen this link to verify your email: ${config.publicUrl}/verify?token=${token}\n`,
  };
}

export function forkNoticeMessage(forker: string, title: string, to: string, forkId: string): Message {
  return {
    to,
    subject: `${forker} forked your pen "${title}"`,
    text: `${forker} forked "${title}" into a new pen.\n\nSee the fork: ${config.publicUrl}/pen/${forkId}\n`,
  };
}
