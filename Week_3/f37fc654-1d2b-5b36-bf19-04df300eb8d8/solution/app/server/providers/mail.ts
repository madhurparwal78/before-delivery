// Plain SMTP to Mailpit (SMTP_HOST:SMTP_PORT), every email from MAIL_FROM.
import net from "node:net";
import { config } from "../config.js";
import { ServiceDown } from "./reach.js";

interface Email {
  to: string[];
  subject: string;
  text: string;
  messageId: string;
}

function address(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

function encodedWord(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function compose(email: Email): string {
  const body = Buffer.from(email.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  const from = config.smtp.from.match(/^(.*?)\s*<([^>]+)>$/);
  const fromHeader = from ? `${encodedWord(from[1].replace(/^"|"$/g, ""))} <${from[2]}>` : config.smtp.from;
  return [
    `From: ${fromHeader}`,
    `To: ${email.to.join(", ")}`,
    `Subject: ${encodedWord(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${email.messageId}@spindrift.rooms>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

export function sendMail(email: Email): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(15_000);
    const steps: string[] = [
      "EHLO spindrift.rooms",
      `MAIL FROM:<${address(config.smtp.from)}>`,
      ...email.to.map((to) => `RCPT TO:<${to}>`),
      "DATA",
      `${compose(email).replace(/^\./gm, "..")}\r\n.`,
      "QUIT",
    ];
    let buffer = "";
    let connected = false;
    let step = -1;
    const finish = (error?: Error): void => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.on("connect", () => {
      connected = true;
    });
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) return finish(new Error(`SMTP ${line}`));
        step += 1;
        if (step >= steps.length) return finish();
        socket.write(`${steps[step]}\r\n`);
      }
      return undefined;
    });
    socket.on("timeout", () => finish(connected ? new Error("SMTP timeout") : new ServiceDown("mailpit")));
    socket.on("error", () => finish(new ServiceDown("mailpit")));
    socket.on("close", () => {
      if (step < steps.length - 1) finish(new ServiceDown("mailpit"));
    });
  });
}
