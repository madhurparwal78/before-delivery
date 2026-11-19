// A plain SMTP client (EHLO, MAIL FROM, RCPT TO, DATA) for SMTP_HOST:SMTP_PORT.
import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";

export interface Message {
  to: string;
  subject: string;
  body: string;
}

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

/** RFC 2047 for a header value that is not plain ASCII. */
function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** An addr-spec on the wire: a local part that is not a dot-atom (it may hold spaces) is sent as a quoted string. */
function mailbox(value: string): string {
  const at = value.lastIndexOf("@");
  const local = value.slice(0, at);
  return /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local) ? value : `"${local}"${value.slice(at)}`;
}

function fromHeader(value: string): string {
  const match = /^(.*)<([^>]+)>$/.exec(value.trim());
  if (!match) return value;
  return `${headerText((match[1] ?? "").trim())} <${match[2]}>`;
}

class Conversation {
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("SMTP connection closed")));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.flush();
  }

  private flush(): void {
    if (!this.waiting) return;
    // A reply is complete at a line whose fourth character is a space.
    const lines = this.buffer.split("\r\n");
    const done = lines.findIndex((line) => /^\d{3} /.test(line));
    if (done >= 0) {
      const reply = lines.slice(0, done + 1).join("\n");
      this.buffer = lines.slice(done + 1).join("\r\n");
      const resolve = this.waiting;
      this.waiting = null;
      resolve(reply);
    } else if (this.failure) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(`000 ${this.failure.message}`);
    }
  }

  reply(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.flush();
    });
  }

  async expect(command: string | null, code: string): Promise<void> {
    if (command !== null) this.socket.write(`${command}\r\n`);
    const reply = await this.reply();
    if (!reply.split("\n").pop()?.startsWith(code)) throw new Error(`SMTP ${command ?? "greeting"}: ${reply}`);
  }
}

export async function sendMail(message: Message): Promise<void> {
  const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP timeout")));
  const smtp = new Conversation(socket);
  try {
    await smtp.expect(null, "220");
    await smtp.expect("EHLO pilotlight", "250");
    await smtp.expect(`MAIL FROM:<${address(config.smtp.from)}>`, "250");
    await smtp.expect(`RCPT TO:<${mailbox(message.to)}>`, "250");
    await smtp.expect("DATA", "354");
    const body = message.body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    const data = [
      `From: ${fromHeader(config.smtp.from)}`,
      `To: <${mailbox(message.to)}>`,
      `Subject: ${headerText(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@pilotlight>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      ".",
    ].join("\r\n");
    await smtp.expect(data, "250");
    await smtp.expect("QUIT", "221");
  } finally {
    socket.destroy();
  }
}
