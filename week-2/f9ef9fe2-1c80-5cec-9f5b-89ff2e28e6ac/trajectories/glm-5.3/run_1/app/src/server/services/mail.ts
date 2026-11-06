import { connect, Socket } from "node:net";
import type { Config } from "../config";

export interface MailService {
  isUp(): Promise<boolean>;
  send(to: string, subject: string, body: string): Promise<void>;
}

/** The address part of a sender like `Pilotlight <no-reply@pilotlight.test>`. */
function address(raw: string): string {
  const match = /<([^>]+)>/.exec(raw);
  return match ? match[1]! : raw;
}

export function makeMail(config: Config): MailService {
  async function send(to: string, subject: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket: Socket = connect({ host: config.smtpHost, port: config.smtpPort });
      let buffer = "";
      let step = 0;
      let settled = false;
      const done = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        socket.end();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      socket.setTimeout(10000, () => done(new Error("mail timeout")));
      socket.on("error", (error: Error) => done(error));
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\r\n");
        buffer = lines.pop() ?? "";
        const line = lines[lines.length - 1] ?? "";
        if (!/^\d{3}[ -]/.test(line)) {
          return;
        }
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (code >= 400) {
          done(new Error(`smtp refused: ${line}`));
          return;
        }
        step += 1;
        switch (step) {
          case 1:
            socket.write("HELO pilotlight\r\n");
            return;
          case 2:
            socket.write(`MAIL FROM:<${address(config.mailFrom)}>\r\n`);
            return;
          case 3:
            socket.write(`RCPT TO:<${to}>\r\n`);
            return;
          case 4:
            socket.write("DATA\r\n");
            return;
          case 5: {
            const headers = [
              `From: ${config.mailFrom}`,
              `To: ${to}`,
              `Subject: ${subject}`,
              "MIME-Version: 1.0",
              "Content-Type: text/plain; charset=utf-8",
            ].join("\r\n");
            const normalized = body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
            socket.write(`${headers}\r\n\r\n${normalized}\r\n.\r\n`);
            return;
          }
          case 6:
            socket.write("QUIT\r\n");
            done();
            return;
          default:
            return;
        }
      });
    });
  }

  async function isUp(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket: Socket = connect({ host: config.smtpHost, port: config.smtpPort });
      let buffer = "";
      socket.setTimeout(5000, () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        if (/^220/.test(buffer)) {
          socket.end();
          resolve(true);
        }
      });
    });
  }

  return { isUp, send };
}
