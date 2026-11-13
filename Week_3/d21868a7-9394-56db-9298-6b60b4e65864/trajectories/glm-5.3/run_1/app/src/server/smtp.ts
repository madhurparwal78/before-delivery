// Minimal SMTP client for the district's mail service. One connection per
// message; retries are driven by the caller.
import { connect as netConnect, type Socket } from "node:net";

export type SmtpConfig = {
  host: string;
  port: number;
  mailFrom: string;
};

export type MailMessage = {
  to: string;
  subject: string;
  body: string;
  attachment?: { filename: string; contentType: string; bytes: Buffer };
};

function encodedWord(subject: string): string {
  const needsEncoding = /[^\x20-\x7e]/.test(subject) || subject.length > 72;
  if (!needsEncoding) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function extractAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1]! : from.trim();
}

// A line-oriented SMTP conversation with a reply queue.
class SmtpSession {
  private readonly sock: Socket;
  private buffer = "";
  private pending: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  private closed = false;

  private constructor(sock: Socket) {
    this.sock = sock;
    sock.on("data", (d: Buffer) => {
      this.buffer += d.toString("utf8");
      let idx: number;
      while ((idx = this.buffer.indexOf("\r\n")) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        const w = this.waiters.shift();
        if (w) w(line);
        else this.pending.push(line);
      }
    });
    sock.on("error", () => {
      this.closed = true;
      while (this.waiters.length) this.waiters.shift()!("ERROR");
    });
    sock.on("close", () => {
      this.closed = true;
      while (this.waiters.length) this.waiters.shift()!("ERROR");
    });
  }

  static connect(cfg: SmtpConfig, timeoutMs: number): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const sock = netConnect({ host: cfg.host, port: cfg.port });
      sock.setTimeout(timeoutMs);
      sock.once("timeout", () => {
        sock.destroy();
        reject(new Error("smtp connect timeout"));
      });
      sock.once("error", (e) => reject(e));
      sock.once("connect", () => resolve(new SmtpSession(sock)));
    });
  }

  // Wait for one reply line.
  private readLine(timeoutMs: number): Promise<string> {
    const pendingLine = this.pending.shift();
    if (pendingLine !== undefined) return Promise.resolve(pendingLine);
    return new Promise((resolve, reject) => {
      const waiter = (line: string) => {
        clearTimeout(timer);
        if (line === "ERROR") reject(new Error("smtp error"));
        else resolve(line);
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error("smtp read timeout"));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  // Multiline replies end with a line whose 4th character is a space.
  private async readReply(code: number, timeoutMs = 8000): Promise<void> {
    for (;;) {
      const line = await this.readLine(timeoutMs);
      const got = parseInt(line.slice(0, 3), 10);
      if (got !== code) throw new Error(`smtp expected ${code} got ${line}`);
      if (line.length <= 3 || line[3] === " ") return;
    }
  }

  private async cmd(cmdline: string, code: number): Promise<void> {
    this.sock.write(`${cmdline}\r\n`);
    await this.readReply(code);
  }

  async sendMail(cfg: SmtpConfig, msg: MailMessage): Promise<void> {
    await this.readReply(220); // greeting
    await this.cmd("EHLO ditchbook", 250);
    await this.cmd(`MAIL FROM:<${extractAddress(cfg.mailFrom)}>`, 250);
    await this.cmd(`RCPT TO:<${extractAddress(msg.to)}>`, 250);
    await this.cmd("DATA", 354);

    const boundary = `ditchbook-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const headers = [
      `From: ${cfg.mailFrom}`,
      `To: ${msg.to}`,
      `Subject: ${encodedWord(msg.subject)}`,
      "MIME-Version: 1.0",
      msg.attachment
        ? `Content-Type: multipart/mixed; boundary="${boundary}"`
        : "Content-Type: text/plain; charset=UTF-8",
    ].join("\r\n");

    let payload: string;
    if (msg.attachment) {
      payload = [
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "",
        msg.body,
        `--${boundary}`,
        `Content-Type: ${msg.attachment.contentType}; name="${msg.attachment.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${msg.attachment.filename}"`,
        "",
        msg.attachment.bytes.toString("base64").replace(/(.{76})/g, "$1\r\n"),
        `--${boundary}--`,
        "",
      ].join("\r\n");
    } else {
      payload = `${msg.body}\r\n`;
    }

    const stuffed = payload.replace(/^\./gm, "..");
    this.sock.write(`${headers}\r\n\r\n${stuffed}\r\n.\r\n`);
    await this.readReply(250, 15000);
    try {
      await this.cmd("QUIT", 221);
    } catch {
      // the server may close first; the message is accepted either way
    }
    this.sock.end();
  }

  destroy(): void {
    if (!this.closed) this.sock.destroy();
  }
}

export async function smtpSend(cfg: SmtpConfig, msg: MailMessage): Promise<boolean> {
  let session: SmtpSession | null = null;
  try {
    session = await SmtpSession.connect(cfg, 8000);
    await session.sendMail(cfg, msg);
    return true;
  } catch {
    return false;
  } finally {
    if (session) session.destroy();
  }
}
