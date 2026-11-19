import { randomUUID } from "node:crypto";
import net from "node:net";
import type { Config } from "./config.js";

export class MailUnavailable extends Error {}

interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

const MAIL_TIMEOUT_MS = 5000;

function address(header: string): string {
  const match = /<([^>]+)>/.exec(header);
  return (match ? match[1] : header).trim();
}

// Sends one plain-text message over SMTP. Rejects with MailUnavailable when the server is
// unreachable or refuses the message within 5 seconds.
export function sendMail(config: Config["smtp"], mail: Mail): Promise<void> {
  const message = [
    `From: ${config.from}`,
    `To: <${mail.to}>`,
    `Subject: ${mail.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${config.helloName}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    ...mail.text.split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line)),
  ].join("\r\n");
  const script = [
    { send: null, expect: 220 },
    { send: `EHLO ${config.helloName}`, expect: 250 },
    { send: `MAIL FROM:<${address(config.from)}>`, expect: 250 },
    { send: `RCPT TO:<${mail.to}>`, expect: 250 },
    { send: "DATA", expect: 354 },
    { send: `${message}\r\n.`, expect: 250 },
    { send: "QUIT", expect: 221 },
  ];

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.host, port: config.port });
    let buffer = "";
    let index = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(new MailUnavailable(error.message));
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error("timed out")), MAIL_TIMEOUT_MS);
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(index >= script.length - 1 ? undefined : new Error("connection closed")));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const lines = buffer.split("\r\n");
        const done = lines.findIndex((line) => /^\d{3} /.test(line));
        if (done < 0) return;
        const code = Number(lines[done].slice(0, 3));
        buffer = lines.slice(done + 1).join("\r\n");
        if (code !== script[index].expect) {
          finish(new Error(`SMTP answered ${code}`));
          return;
        }
        index += 1;
        if (index === script.length) {
          finish();
          return;
        }
        socket.write(`${script[index].send}\r\n`);
      }
    });
  });
}
