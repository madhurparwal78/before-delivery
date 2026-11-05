import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { config } from "./config.js";

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

function header(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function message(mail: Mail): string {
  const domain = address(config.smtp.from).split("@")[1] ?? "localhost";
  const lines = [
    `From: ${config.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${header(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    ...mail.body.split(/\r?\n/).map((line) => (line.startsWith(".") ? `.${line}` : line)),
  ];
  return `${lines.join("\r\n")}\r\n.\r\n`;
}

/** Sends one plain-text email over SMTP (no attachments, ever). */
export function sendMail(mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const steps = [
      `EHLO opaline-bench-days`,
      `MAIL FROM:<${address(config.smtp.from)}>`,
      `RCPT TO:<${address(mail.to)}>`,
      "DATA",
      message(mail),
      "QUIT",
    ];
    let buffer = "";
    let step = -1;
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(10_000, () => fail(new Error("SMTP timeout")));
    socket.on("error", fail);
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (code >= 400) return fail(new Error(`SMTP ${code}`));
        step += 1;
        const next = steps[step];
        if (next === undefined) {
          socket.end();
          return resolve();
        }
        socket.write(next.endsWith("\r\n.\r\n") ? next : `${next}\r\n`);
      }
    });
    socket.connect(config.smtp.port, config.smtp.host);
  });
}
