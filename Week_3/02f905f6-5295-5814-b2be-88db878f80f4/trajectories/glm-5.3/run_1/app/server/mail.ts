import net from "node:net";
import type { AppConfig } from "./config.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

function envelopeAddress(header: string): string {
  const match = header.match(/<([^>]+)>/);
  if (match) return match[1];
  return header.trim();
}

// Minimal SMTP client for the studio mail server (Mailpit). Speaks the small
// subset of SMTP the studio mail server needs: EHLO, MAIL, RCPT, DATA, QUIT.
export class MailClient {
  constructor(private cfg: AppConfig) {}

  async send(email: OutgoingEmail): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: this.cfg.smtp.host, port: this.cfg.smtp.port });
      socket.setTimeout(10_000);
      let buffer = "";
      let stage: "greeting" | "ehlo" | "mail" | "rcpt" | "data" | "body" | "quit" = "greeting";
      let settled = false;

      const fail = () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
        socket.destroy();
      };

      const finish = () => {
        if (!settled) {
          settled = true;
          resolve(true);
        }
        socket.destroy();
      };

      const step = (code: number) => {
        // SMTP replies are three-digit: 2xx success, 3xx continue.
        if (code < 200 || code >= 400) {
          fail();
          return;
        }
        switch (stage) {
          case "greeting":
            stage = "ehlo";
            socket.write("EHLO shelfmark\r\n");
            break;
          case "ehlo":
            stage = "mail";
            socket.write(`MAIL FROM:<${envelopeAddress(this.cfg.smtp.mailFrom)}>\r\n`);
            break;
          case "mail":
            stage = "rcpt";
            socket.write(`RCPT TO:<${envelopeAddress(email.to)}>\r\n`);
            break;
          case "rcpt":
            stage = "data";
            socket.write("DATA\r\n");
            break;
          case "data":
            stage = "body";
            {
              const bareFrom = envelopeAddress(this.cfg.smtp.mailFrom);
              const fromLine = this.cfg.smtp.mailFrom.includes("<")
                ? this.cfg.smtp.mailFrom
                : `${this.cfg.smtp.mailFrom} <${bareFrom}>`;
              const toLine = email.to.includes("<") ? email.to : envelopeAddress(email.to);
              const message = [
                `From: ${fromLine}`,
                `To: ${toLine}`,
                `Subject: ${email.subject}`,
                `Content-Type: text/plain; charset=utf-8`,
                `MIME-Version: 1.0`,
                "",
                email.body.replace(/^\./gm, ".."),
                "."
              ].join("\r\n");
              socket.write(message + "\r\n");
            }
            break;
          case "body":
            stage = "quit";
            socket.write("QUIT\r\n");
            break;
          case "quit":
            finish();
            break;
        }
      };

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let index: number;
        while ((index = buffer.indexOf("\r\n")) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (line.length < 3) continue;
          const code = parseInt(line.slice(0, 3), 10);
          if (line[3] === "-") continue; // multiline continuation
          step(code);
          if (settled) return;
        }
      });
      socket.on("error", fail);
      socket.on("timeout", fail);
      socket.on("close", () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
    });
  }

  async verify(): Promise<boolean> {
    try {
      await this.send({ to: "shelfmark-health@brickfieldlane.example", subject: "Health probe", body: "Health probe" });
      return true;
    } catch {
      return false;
    }
  }
}
