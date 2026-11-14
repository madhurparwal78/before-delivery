import net from "node:net";
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";

/** Mailpit refused the mail or could not be reached. */
export class MailError extends Error {}

const addressOf = (from: string): string => {
  const open = from.indexOf("<");
  return open >= 0 ? from.slice(open + 1, from.indexOf(">")) : from.trim();
};

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

function build(to: string, subject: string, text: string): string {
  const body = Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@runupbay>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Sends one plain-text mail through SMTP; resolves only when the server accepts it. */
export function sendMail(to: string, subject: string, text: string): Promise<void> {
  const replies = [220, 250, 250, 250, 354, 250];
  const commands = [
    "EHLO runupbay",
    `MAIL FROM:<${addressOf(config.smtp.from)}>`,
    `RCPT TO:<${to}>`,
    "DATA",
    `${build(to, subject, text)}\r\n.`,
    "QUIT",
  ];
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(8000);
    let step = 0;
    let buffer = "";
    let settled = false;
    const finish = (error?: MailError): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const refuse = (): void => finish(new MailError("mail not accepted"));
    socket.on("error", refuse);
    socket.on("timeout", refuse);
    socket.on("close", refuse);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      const last = lines[lines.length - 2];
      if (last === undefined || !/^\d{3} /.test(last)) return;
      buffer = "";
      if (Number(last.slice(0, 3)) !== replies[step]) return refuse();
      const command = commands[step];
      step += 1;
      if (step === replies.length) {
        socket.write(`${command}\r\n`);
        finish();
        return;
      }
      socket.write(`${command}\r\n`);
    });
  });
}
