import { connect as netConnect, Socket } from "node:net";

/**
 * A minimal SMTP client for the Mailpit sink (DP-59, DP-62). If mail cannot be
 * sent, callers still succeed with the published copy holding.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
}

interface Reply { code: number; final: boolean }

/** A line-oriented SMTP conversation with proper multi-line reply handling. */
class SmtpConnection {
  private buffer = "";
  private replies: Reply[] = [];

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf("\r\n")) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        const code = Number(line.slice(0, 3));
        const final = line.length < 4 || line[3] !== "-";
        const last = this.replies[this.replies.length - 1];
        if (last && !last.final) {
          last.final = final;
        } else {
          this.replies.push({ code, final });
        }
      }
    });
  }

  waitReply(): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = (): void => {
        const first = this.replies[0];
        if (first && first.final) {
          this.replies.shift();
          resolve(first);
          return;
        }
        if (Date.now() - started > 5000) {
          reject(new Error("smtp reply timeout"));
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });
  }

  async command(line: string): Promise<Reply> {
    this.socket.write(line + "\r\n");
    return this.waitReply();
  }

  end(): void {
    this.socket.end();
  }
}

export async function sendMail(cfg: SmtpConfig, to: string, subject: string, bodyLines: string[]): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = netConnect(cfg.port, cfg.host);
    s.setTimeout(5000, () => {
      s.destroy();
      reject(new Error("smtp connect timeout"));
    });
    s.once("connect", () => {
      s.setTimeout(0);
      resolve(s);
    });
    s.once("error", reject);
  });
  const conn = new SmtpConnection(socket);
  try {
    await conn.waitReply(); // greeting
    await conn.command("EHLO jarful");
    await conn.command("MAIL FROM:<" + extractAddress(cfg.from) + ">");
    await conn.command("RCPT TO:<" + to + ">");
    await conn.command("DATA");
    const text =
      "From: " + cfg.from + "\r\n" +
      "To: <" + to + ">\r\n" +
      "Subject: " + subject + "\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "\r\n" +
      bodyLines.join("\r\n") + "\r\n" +
      ".\r\n";
    socket.write(text);
    await conn.waitReply();
    await conn.command("QUIT");
  } finally {
    conn.end();
  }
}

function extractAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return m ? m[1] : from;
}
