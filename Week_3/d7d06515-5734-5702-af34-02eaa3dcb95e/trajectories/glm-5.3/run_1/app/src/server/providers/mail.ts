import * as net from "node:net";
import { config } from "../config.js";

export interface MailState {
  available: boolean;
  lastCheck: number;
}

export const mailState: MailState = { available: false, lastCheck: 0 };

const CRLF = "\r\n";

function dotStuff(text: string): string {
  return text.replace(/\r?\n/g, CRLF).replace(/(^|(\r\n))\./g, "$1..");
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** True only when the SMTP server accepts the message (final 250 reply). */
export async function sendMail(message: MailMessage): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(10_000);
    let buffer = "";
    let finished = false;
    let stage = 0;
    const done = (ok: boolean) => {
      if (finished) return;
      finished = true;
      mailState.available = ok;
      mailState.lastCheck = Date.now();
      socket.destroy();
      resolve(ok);
    };
    const command = (line: string) => {
      socket.write(line + CRLF);
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(CRLF);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (finished) return;
        if (!/^\d{3}/.test(line)) continue;
        // A reply is complete only on its final line: ddd<SP>, not ddd-.
        if (line.length > 3 && line[3] === "-") continue;
        const code = Number.parseInt(line.slice(0, 3), 10);
        stage += 1;
        if (stage === 1) {
          if (code !== 220) return done(false);
          command("EHLO corbelworks.local");
          continue;
        }
        if (stage === 2) {
          if (code !== 250) return done(false);
          command(`MAIL FROM:<${extractAddress(config.mailFrom)}>`);
          continue;
        }
        if (stage === 3) {
          if (code !== 250) return done(false);
          command(`RCPT TO:<${message.to}>`);
          continue;
        }
        if (stage === 4) {
          if (code !== 250) return done(false);
          command("DATA");
          continue;
        }
        if (stage === 5) {
          if (code !== 354) return done(false);
          const body = [
            `From: ${config.mailFrom}`,
            `To: ${message.to}`,
            `Subject: ${message.subject}`,
            `Content-Type: text/plain; charset=utf-8`,
            `Date: ${new Date().toUTCString()}`,
            ``,
            message.text,
          ].join(CRLF);
          socket.write(dotStuff(body) + CRLF + `.` + CRLF);
          continue;
        }
        if (stage === 6) {
          if (code !== 250) return done(false);
          command("QUIT");
          done(true);
          continue;
        }
        if (code >= 400) return done(false);
      }
    });
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
    socket.on("close", () => done(false));
  });
}

function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from.trim();
}
