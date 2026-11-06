import { connect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";

const TIMEOUT_MS = 10_000;

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

/** Quoted-printable encoding of UTF-8 text with CRLF line breaks and soft breaks at 76 characters. */
function quotedPrintable(text: string): string {
  return text
    .replace(/\r?\n/g, "\n")
    .split("\n")
    .map((line) => {
      const bytes = Buffer.from(line, "utf8");
      let encoded = "";
      bytes.forEach((b, i) => {
        const last = i === bytes.length - 1;
        const plain = (b >= 33 && b <= 126 && b !== 61) || (b === 32 && !last) || (b === 9 && !last);
        encoded += plain ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
      });
      const parts: string[] = [];
      while (encoded.length > 76) {
        let cut = 75;
        const eq = encoded.lastIndexOf("=", cut - 1);
        if (eq > cut - 3) cut = eq;
        parts.push(`${encoded.slice(0, cut)}=`);
        encoded = encoded.slice(cut);
      }
      parts.push(encoded);
      return parts.join("\r\n");
    })
    .join("\r\n");
}

function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1]! : from).trim();
}

/** Every header is fixed text or the validated recipient; no user-written value reaches a header. */
function message(mail: OutgoingMail): string {
  const domain = addressOf(config.mail.from).split("@")[1] ?? "localhost";
  const headers = [
    `From: ${config.mail.from}`,
    `To: <${mail.to}>`,
    `Subject: ${mail.subject}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
  ];
  for (const h of headers) if (/[\r\n\u0000-\u001f\u007f]/.test(h) || !/^[\x20-\x7e]*$/.test(h)) throw new Error("unsafe mail header");
  const body = quotedPrintable(mail.body).split("\r\n").map((l) => (l.startsWith(".") ? `.${l}` : l)).join("\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n`;
}

class SmtpSession {
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
  }

  private flush(): void {
    // A reply is complete at a line whose fourth character is a space ("250 ok"), after any "250-" continuation lines.
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i]!) && this.waiting) {
        const reply = lines.slice(0, i + 1).join("\n");
        this.buffer = lines.slice(i + 1).join("\r\n");
        const done = this.waiting;
        this.waiting = null;
        done(reply);
        return;
      }
    }
  }

  reply(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.flush();
    });
  }

  async command(line: string | null, expect: number): Promise<void> {
    if (line !== null) this.socket.write(`${line}\r\n`);
    const reply = await this.reply();
    if (!reply.startsWith(String(expect))) throw new Error(`SMTP refused (${reply.slice(0, 3)})`);
  }
}

export function sendMail(mail: OutgoingMail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout")));
    socket.once("error", reject);
    socket.once("connect", () => {
      const smtp = new SmtpSession(socket);
      (async () => {
        await smtp.command(null, 220);
        await smtp.command("EHLO scopewright", 250);
        await smtp.command(`MAIL FROM:<${addressOf(config.mail.from)}>`, 250);
        await smtp.command(`RCPT TO:<${mail.to}>`, 250);
        await smtp.command("DATA", 354);
        await smtp.command(`${message(mail)}.`, 250);
        socket.end("QUIT\r\n");
      })().then(resolve, (error: unknown) => {
        socket.destroy();
        reject(error);
      });
    });
  });
}

/** Whether the mail server accepts a TCP connection right now. */
export function mailReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: config.mail.host, port: config.mail.port });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
