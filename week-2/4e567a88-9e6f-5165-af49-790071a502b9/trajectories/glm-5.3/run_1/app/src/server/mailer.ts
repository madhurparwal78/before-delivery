// Mail delivery over SMTP, used by the background loops and top-ups.
import { connect as netConnect, Socket } from "node:net";

export interface MailConfig {
  host: string;
  port: number;
  from: string;
}

interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

export class Mailer {
  private queue: MailMessage[] = [];
  private sending = false;

  constructor(private cfg: MailConfig) {}

  send(to: string, subject: string, body: string): void {
    this.queue.push({ to, subject, body });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length > 0) {
        const msg = this.queue.shift();
        if (!msg) break;
        try {
          await this.deliver(msg);
        } catch {
          // Mail is best-effort; a failed send is dropped.
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private deliver(msg: MailMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket: Socket = netConnect({ host: this.cfg.host, port: this.cfg.port });
      const fromAddr = extractAddress(this.cfg.from);
      let buffer = "";
      let expecting = "greeting" as "greeting" | "ehlo" | "mail" | "rcpt" | "data" | "sent";
      socket.setTimeout(10_000);

      const fail = (e: string | Error) => {
        socket.destroy();
        reject(typeof e === "string" ? new Error(e) : e);
      };

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        // A complete SMTP reply ends with a line "NNN <text>" (space, not dash).
        if (!/\r\n\d{3} /.test(buffer) && !/^\d{3} /.test(buffer)) return;
        const code = Number(buffer.slice(0, 3));
        buffer = "";
        if (expecting === "greeting") {
          if (code !== 220) return fail(`smtp greeting ${code}`);
          expecting = "ehlo";
          socket.write("EHLO dispatch\r\n");
        } else if (expecting === "ehlo") {
          if (code !== 250) return fail(`smtp ehlo ${code}`);
          expecting = "mail";
          socket.write(`MAIL FROM:<${fromAddr}>\r\n`);
        } else if (expecting === "mail") {
          if (code !== 250) return fail(`smtp mail ${code}`);
          expecting = "rcpt";
          socket.write(`RCPT TO:<${msg.to}>\r\n`);
        } else if (expecting === "rcpt") {
          if (code !== 250 && code !== 251) return fail(`smtp rcpt ${code}`);
          expecting = "data";
          socket.write("DATA\r\n");
        } else if (expecting === "data") {
          if (code !== 354) return fail(`smtp data ${code}`);
          expecting = "sent";
          const text = [
            `From: ${this.cfg.from}`,
            `To: ${msg.to}`,
            `Subject: ${msg.subject}`,
            `Content-Type: text/plain; charset=utf-8`,
            ``,
            msg.body.replace(/^\./gm, ".."),
          ].join("\r\n");
          socket.write(text + "\r\n.\r\n");
        } else if (expecting === "sent") {
          if (code !== 250) return fail(`smtp sent ${code}`);
          socket.write("QUIT\r\n");
          socket.end();
          resolve();
        }
      });
      socket.on("timeout", () => fail("smtp timeout"));
      socket.on("error", (e) => fail(e));
    });
  }
}

function extractAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from.trim();
}
