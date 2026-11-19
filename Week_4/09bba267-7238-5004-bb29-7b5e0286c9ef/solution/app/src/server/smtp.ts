// A plain-text SMTP client for the configured mail server (Mailpit): EHLO, MAIL, RCPT, DATA, QUIT.
import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "./config.js";

const TIMEOUT_MS = 10_000;

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

const senderAddress = /<([^>]+)>/.exec(config.mailFrom)?.[1] ?? config.mailFrom.trim();

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeFrom(value: string): string {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(value);
  return match?.[1] ? `${encodeHeader(match[1].replace(/^"|"$/g, ""))} <${match[2]}>` : value;
}

function compose(message: MailMessage): string {
  const domain = senderAddress.split("@")[1] ?? "localhost";
  const body = message.body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return [
    `From: ${encodeFrom(config.mailFrom)}`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

/** Reads one complete SMTP reply (all continuation lines) and resolves with its code. */
function replies(socket: Socket): () => Promise<number> {
  let buffer = "";
  const waiting: ((code: number) => void)[] = [];
  const ready: number[] = [];
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let end: number;
    while ((end = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const code = Number(line.slice(0, 3));
        const next = waiting.shift();
        if (next) next(code);
        else ready.push(code);
      }
    }
  });
  return () => {
    const code = ready.shift();
    return code === undefined ? new Promise((resolve) => waiting.push(resolve)) : Promise.resolve(code);
  };
}

/** Hands one message to the SMTP server; rejects on a refused connection, an error reply or 10 s without an answer. */
export function sendMail(message: MailMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    const fail = (reason: string): void => {
      socket.destroy();
      reject(new Error(reason));
    };
    socket.setTimeout(TIMEOUT_MS, () => fail("smtp timeout"));
    socket.on("error", (error) => fail(error.message));
    socket.on("close", () => fail("smtp connection closed"));
    const next = replies(socket);
    const expect = async (codes: number[], command?: string): Promise<void> => {
      if (command !== undefined) socket.write(`${command}\r\n`);
      const code = await next();
      if (!codes.includes(code)) throw new Error(`smtp ${command ?? "greeting"} answered ${code}`);
    };
    socket.once("connect", () => {
      (async () => {
        await expect([220]);
        await expect([250], `EHLO ${senderAddress.split("@")[1] ?? "localhost"}`);
        await expect([250], `MAIL FROM:<${senderAddress}>`);
        await expect([250, 251], `RCPT TO:<${message.to}>`);
        await expect([354], "DATA");
        await expect([250], `${compose(message)}\r\n.`);
        socket.end("QUIT\r\n");
        resolve();
      })().catch((error: Error) => fail(error.message));
    });
  });
}
