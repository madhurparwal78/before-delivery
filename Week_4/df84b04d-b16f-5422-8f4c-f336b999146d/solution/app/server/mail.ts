import net from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export class MailError extends Error {}

const TIMEOUT_MS = 5000;

function mailbox(from: string): string {
  const start = from.indexOf("<");
  return start < 0 ? from.trim() : from.slice(start + 1, from.indexOf(">"));
}

function headerText(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function wrapBase64(value: string): string {
  return (Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function compose(to: string, subject: string, body: string): string {
  return [
    `From: ${config.mailFrom}`,
    `To: <${to}>`,
    `Subject: ${headerText(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@twigline>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(body),
  ].join("\r\n");
}

class Conversation {
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;
  private queued: string[] = [];
  private failure: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let end = this.buffer.indexOf("\r\n"); end >= 0; end = this.buffer.indexOf("\r\n")) {
        this.queued.push(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + 2);
      }
      this.wake();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new MailError("connection closed")));
    socket.setTimeout(TIMEOUT_MS, () => this.fail(new MailError("timed out")));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.wake();
  }

  private wake(): void {
    const waiting = this.waiting;
    if (waiting !== null && (this.queued.length > 0 || this.failure !== null)) {
      this.waiting = null;
      waiting("");
    }
  }

  private async line(): Promise<string> {
    while (this.queued.length === 0) {
      if (this.failure !== null) throw new MailError(this.failure.message);
      await new Promise<string>((resolve) => { this.waiting = resolve; });
    }
    return this.queued.shift() ?? "";
  }

  async reply(expected: string): Promise<void> {
    for (;;) {
      const line = await this.line();
      if (!line.startsWith(expected)) throw new MailError(`unexpected reply: ${line}`);
      if (line[3] !== "-") return;
    }
  }

  async command(text: string, expected: string): Promise<void> {
    this.socket.write(`${text}\r\n`);
    await this.reply(expected);
  }

  write(text: string): void {
    this.socket.write(text);
  }
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
  const talk = new Conversation(socket);
  try {
    await talk.reply("220");
    await talk.command("EHLO twigline", "250");
    await talk.command(`MAIL FROM:<${mailbox(config.mailFrom)}>`, "250");
    await talk.command(`RCPT TO:<${to}>`, "250");
    await talk.command("DATA", "354");
    const stuffed = compose(to, subject, body).replace(/^\./gm, "..");
    talk.write(`${stuffed}\r\n.\r\n`);
    await talk.reply("250");
    socket.write("QUIT\r\n");
  } catch (error) {
    throw error instanceof MailError ? error : new MailError(String(error));
  } finally {
    socket.destroy();
  }
}

function minutes(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds / 60));
  return `${whole} ${whole === 1 ? "minute" : "minutes"}`;
}

export const signupCodeMail = (name: string, code: string) => ({
  subject: `Your Twigline code is ${code}`,
  body: `Hello ${name},\n\nYour Twigline confirmation code is ${code}.\n\nIt expires in ${minutes(config.confirmCodeSeconds)}.\n\nIf you did not ask for it, you can ignore this message.\n`,
});

export const takenMail = () => ({
  subject: "Someone tried to sign up with your email",
  body: `Someone tried to sign up for Twigline with this email address, which already has an account.\n\nIf it was you, sign in here: ${config.publicUrl}/signin\n\nIf it was not you, no action is needed.\n`,
});

export const invitationMail = (inviter: string, branch: string, token: string) => ({
  subject: `${inviter} shared a branch with you: ${branch}`,
  body: `${inviter} invited you to edit the branch "${branch}" on Twigline.\n\nOpen the invitation: ${config.publicUrl}/invite/${token}\n\nYou will only see that branch and what is inside it.\n`,
});
