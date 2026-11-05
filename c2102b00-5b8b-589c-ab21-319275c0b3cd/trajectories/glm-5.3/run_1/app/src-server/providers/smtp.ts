import { connect, Socket } from "node:net";
import { config } from "../db";

export interface OutgoingMessage {
  toEmail: string;
  subject: string;
  body: string;
  messageId: string;
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  // UTF-8 encoded words, splitting on code-point boundaries only.
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of subject) {
    const size = Buffer.byteLength(ch, "utf8");
    if (currentBytes + size > 45) {
      chunks.push(current);
      current = ch;
      currentBytes = size;
    } else {
      current += ch;
      currentBytes += size;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks.map((c) => `=?utf-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`).join(" ");
}

function envelopeAddress(fromHeader: string): string {
  const m = /<([^>]+)>/.exec(fromHeader);
  return m ? m[1] : fromHeader.trim();
}

class SmtpSession {
  private socket!: Socket;
  private buffer = "";
  private waiters: ((chunk: string) => void)[] = [];

  private expectLine(): Promise<string> {
    if (this.buffer.includes("\r\n")) {
      const idx = this.buffer.indexOf("\r\n");
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      return Promise.resolve(line);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    while (this.buffer.includes("\r\n") && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      const idx = this.buffer.indexOf("\r\n");
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      waiter(line);
    }
  }

  private static code(line: string): number {
    return parseInt(line.slice(0, 3), 10);
  }

  /** Reads one reply, including any continuation lines. */
  private async readReply(): Promise<void> {
    for (;;) {
      const line = await this.expectLine();
      if (line.length >= 4 && line[3] === "-") continue;
      const code = SmtpSession.code(line);
      if (code >= 500) throw new Error(`SMTP refused: ${line}`);
      return;
    }
  }

  private async command(text: string): Promise<void> {
    this.socket.write(`${text}\r\n`);
    await this.readReply();
  }

  async send(msg: OutgoingMessage): Promise<void> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const s = connect({ host: config.smtpHost, port: config.smtpPort });
      s.setTimeout(8000, () => {
        s.destroy();
        reject(new Error("SMTP connection timed out"));
      });
      s.once("connect", () => {
        s.setTimeout(0);
        resolve(s);
      });
      s.once("error", (err) => reject(err));
    });
    this.socket = socket;
    socket.on("data", (c) => this.onData(c));
    socket.on("error", () => {
      const waiters = this.waiters.splice(0);
      for (const w of waiters) w("421 lost");
    });
    try {
      await this.readReply(); // greeting
      await this.command(`EHLO ${envelopeHost()}`);
      await this.command(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`);
      await this.command(`RCPT TO:<${msg.toEmail}>`);
      await this.command("DATA");
      const message = [
        `From: ${config.mailFrom}`,
        `To: ${msg.toEmail}`,
        `Subject: ${encodeSubject(msg.subject)}`,
        `Message-ID: <${msg.messageId}>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        msg.body,
      ].join("\r\n");
      const dotSafe = message.replace(/\r?\n\./g, (m) => (m === "\n." ? "\n.." : "\r\n.."));
      socket.write(dotSafe);
      socket.write("\r\n.\r\n");
      await this.readReply(); // message accepted
      try {
        await this.command("QUIT");
      } catch {
        // Some servers close before QUIT is answered.
      }
    } finally {
      socket.destroy();
    }
  }
}

function envelopeHost(): string {
  return process.env.HOSTNAME || "tare-and-tally.local";
}

/** Sends one message; resolves when SMTP accepts it. */
export function smtpSend(msg: OutgoingMessage): Promise<void> {
  return new SmtpSession().send(msg);
}
