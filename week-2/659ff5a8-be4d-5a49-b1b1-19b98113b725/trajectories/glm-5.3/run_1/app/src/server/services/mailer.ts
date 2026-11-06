// Raw SMTP client speaking to Mailpit. Sends are plain sockets; STARTTLS is
// not needed for the sink and is not negotiated.
import { connect, type Socket } from "node:net";
import type { AppConfig } from "../config.js";

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

const CRLF = "\r\n";

export class Mailer {
  private host: string;
  private port: number;
  from: string;

  constructor(config: AppConfig["smtp"], mailFrom: string) {
    this.host = config.host;
    this.port = config.port;
    this.from = mailFrom;
  }

  /** Returns true when the server accepted the message (250 at end of DATA). */
  send(message: MailMessage): Promise<boolean> {
    return new Promise((resolve) => {
      let accepted = false;
      const socket: Socket = connect(this.port, this.host);
      socket.setTimeout(10_000);
      let stage = "greeting";
      let buffer = "";

      const fail = () => {
        try { socket.destroy(); } catch { /* already closed */ }
        resolve(false);
      };

      const talk = () => {
        const lines = buffer.split(CRLF);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          // Multiline replies: the final line has a space after the code.
          if (line.length > 3 && line[3] === "-") continue;
          const code = Number(line.slice(0, 3));
          if (Number.isNaN(code)) continue;
          if (stage === "greeting" && code === 220) { stage = "ehlo"; socket.write(`EHLO paddock${CRLF}`); }
          else if (stage === "ehlo" && code === 250) { stage = "mail"; socket.write(`MAIL FROM:<${bareAddress(this.from)}>${CRLF}`); }
          else if (stage === "mail" && code === 250) { stage = "rcpt"; socket.write(`RCPT TO:<${message.to}>${CRLF}`); }
          else if (stage === "rcpt" && code === 250) { stage = "data"; socket.write(`DATA${CRLF}`); }
          else if (stage === "data" && code === 354) {
            stage = "body";
            socket.write(buildMessage(this.from, message.to, message.subject, message.body));
            socket.write(`${CRLF}.${CRLF}`);
          } else if (stage === "body" && code === 250) {
            accepted = true;
            socket.write(`QUIT${CRLF}`);
            socket.end();
          } else if (code >= 400) {
            fail();
            return;
          }
        }
      };

      socket.on("data", (chunk) => { buffer += chunk.toString("utf8"); talk(); });
      socket.on("timeout", fail);
      socket.on("error", fail);
      socket.on("close", () => resolve(accepted));
    });
  }
}

export function bareAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function buildMessage(from: string, to: string, subject: string, body: string): string {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
  ];
  return headers.join(CRLF) + CRLF + CRLF + body.replace(/\r?\n/g, CRLF) + CRLF;
}
