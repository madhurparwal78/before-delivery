// A minimal SMTP client (EHLO, MAIL FROM, RCPT TO, DATA) for the provided Mailpit.
import { connect, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";

const TIMEOUT_MS = 10_000;

function mailAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
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
    const reply = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(this.buffer);
    if (reply) {
      const end = reply.index + reply[0].length;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      const resolve = this.waiting;
      this.waiting = null;
      resolve(line);
    } else if (this.failure) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve("");
    }
  }

  async expect(code: string): Promise<void> {
    const reply = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.flush();
    });
    const last = reply.trimEnd().split("\r\n").pop() ?? "";
    if (!last.startsWith(code)) throw this.failure ?? new Error(`SMTP expected ${code}, got ${last}`);
  }

  async send(line: string, code: string): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(code);
  }
}

function open(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout")));
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** Sends one plain-text message to one recipient, from MAIL_FROM. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const socket = await open();
  const talk = new Conversation(socket);
  try {
    const from = mailAddress(config.smtp.from);
    await talk.expect("220");
    await talk.send("EHLO tern-foils", "250");
    await talk.send(`MAIL FROM:<${from}>`, "250");
    await talk.send(`RCPT TO:<${to}>`, "250");
    await talk.send("DATA", "354");
    const headers = [
      `From: ${config.smtp.from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@${from.split("@")[1] ?? "localhost"}>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
    ];
    const text = body.split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line));
    await talk.send([...headers, "", ...text, "."].join("\r\n"), "250");
    await talk.send("QUIT", "221").catch(() => undefined);
  } finally {
    socket.destroy();
  }
}
