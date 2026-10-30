// A minimal SMTP client: one message, one recipient per connection. Subjects that are not plain printable
// ASCII (or that contain "=?") are sent as RFC 2047 UTF-8 encoded-words folded onto continuation lines.
import { connect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";

const TIMEOUT_MS = 5000;

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

/** Plain when entirely printable ASCII without "=?"; otherwise base64 encoded-words of at most 45 bytes each. */
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject) && !subject.includes("=?")) return subject;
  const words: string[] = [];
  let chunk = "";
  for (const ch of subject) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m?.[1] ?? from).trim();
}

const base64Lines = (text: string): string =>
  (Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

function message(mail: OutgoingMail): string {
  const domain = addressOf(config.smtp.from).split("@")[1] ?? "localhost";
  return [
    `From: ${config.smtp.from}`,
    `To: <${mail.to}>`,
    `Subject: ${encodeSubject(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(mail.body),
  ].join("\r\n");
}

class Conversation {
  private buffer = "";
  private waiter: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (data: string) => {
      this.buffer += data;
      this.flush();
    });
    const fail = (error: Error): void => {
      this.failure = error;
      this.waiter?.("");
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("SMTP connection closed")));
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout")));
  }

  private flush(): void {
    if (!this.waiter) return;
    // A reply is complete at a line "NNN text" (no dash after the code).
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^\d{3} /.test(lines[i] ?? "")) {
        const reply = lines.slice(0, i + 1).join("\r\n");
        this.buffer = lines.slice(i + 1).join("\r\n");
        const waiter = this.waiter;
        this.waiter = null;
        waiter?.(reply);
        return;
      }
    }
  }

  async reply(expect: string): Promise<void> {
    if (this.failure) throw this.failure;
    const line = await new Promise<string>((resolve) => {
      this.waiter = resolve;
      this.flush();
    });
    if (this.failure) throw this.failure;
    if (!line.startsWith(expect)) throw new Error(`SMTP answered ${line.slice(0, 80)}`);
  }

  async send(command: string, expect: string): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.reply(expect);
  }
}

/** Delivers one message; throws when the server is unreachable or refuses it. */
export async function deliver(mail: OutgoingMail): Promise<void> {
  const socket = connect({ host: config.smtp.host, port: config.smtp.port });
  const talk = new Conversation(socket);
  try {
    await talk.reply("220");
    await talk.send("EHLO saltprint-desk", "250");
    await talk.send(`MAIL FROM:<${addressOf(config.smtp.from)}>`, "250");
    await talk.send(`RCPT TO:<${mail.to}>`, "250");
    await talk.send("DATA", "354");
    await talk.send(`${message(mail)}\r\n.`, "250");
    socket.end("QUIT\r\n");
  } finally {
    socket.destroy();
  }
}
