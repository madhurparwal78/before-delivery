import { connect as netConnect, type Socket } from "node:net";
import { config } from "../config";

// SMTP client for Mailpit. Every email is sent from the configured MAIL_FROM to the
// person's own email address.

function parseFrom(raw: string): { name: string; address: string } {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1], address: match[2] };
  return { name: "", address: raw.trim() };
}

class LineReader {
  private buffer = "";
  private lines: string[] = [];
  private waiters: ((line: string) => void)[] = [];

  push(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    const parts = this.buffer.split("\r\n");
    this.buffer = parts.pop() ?? "";
    for (const line of parts) this.lines.push(line);
    this.flush();
  }

  private flush(): void {
    while (this.waiters.length > 0 && this.lines.length > 0) {
      const waiter = this.waiters.shift();
      const line = this.lines.shift();
      if (waiter && line !== undefined) waiter(line);
    }
  }

  next(): Promise<string> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  // Read until the final line of a (possibly multi-line) SMTP reply.
  async reply(): Promise<string> {
    for (;;) {
      const line = await this.next();
      if (/^\d{3} /.test(line) || !/^\d{3}/.test(line)) return line;
    }
  }
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const { name, address } = parseFrom(config.mailFrom);
  const fromHeader = name ? `"${name.replace(/["\\]/g, "")}" <${address}>` : address;
  const sock: Socket = netConnect({ host: config.smtpHost, port: config.smtpPort });
  sock.setTimeout(15000);
  const reader = new LineReader();
  sock.on("data", (chunk: Buffer) => reader.push(chunk));
  await new Promise<void>((resolve, reject) => {
    sock.once("error", reject);
    sock.once("connect", resolve);
  });
  try {
    await reader.reply(); // 220 greeting
    sock.write("EHLO kiln-desk\r\n");
    await reader.reply();
    sock.write(`MAIL FROM:<${address}>\r\n`);
    await reader.reply();
    sock.write(`RCPT TO:<${to}>\r\n`);
    await reader.reply();
    sock.write("DATA\r\n");
    await reader.reply();
    const headers = [`From: ${fromHeader}`, `To: <${to}>`, `Subject: ${subject}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="utf-8"', ""].join("\r\n");
    const safeBody = body.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
    sock.write(`${headers}\r\n${safeBody}\r\n.\r\n`);
    await reader.reply();
    sock.write("QUIT\r\n");
    await new Promise<void>((resolve) => {
      sock.once("close", resolve);
      setTimeout(resolve, 2000);
    });
  } finally {
    sock.destroy();
  }
}
