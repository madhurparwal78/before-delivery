// Minimal SMTP client: no authentication, no TLS, one recipient per message.
import * as nodeNet from "node:net";
import type { Env } from "../core/env.js";

export interface MailMessage {
  to: string;
  fromAddress: string;
  fromLine: string;
  messageId: string;
  subject: string;
  body: string;
}

export class MailDownError extends Error {
  constructor() {
    super("mail server unreachable");
  }
}

export async function sendMail(env: Env, message: MailMessage): Promise<void> {
  const socket = await connect(env);
  try {
    await expectReply(socket, [220]);
    await command(socket, `HELO loafline`, [250]);
    await command(socket, `MAIL FROM:<${message.fromAddress}>`, [250]);
    await command(socket, `RCPT TO:<${message.to}>`, [250, 251]);
    await command(socket, `DATA`, [354]);
    const data = buildData(message);
    await command(socket, `${data}\r\n.`, [250]);
    await command(socket, `QUIT`, [221]);
  } finally {
    socket.destroy();
  }
}

/** Open-and-close check used by the outbox recovery loop. */
export async function pingMail(env: Env): Promise<boolean> {
  try {
    const socket = await connect(env);
    const reply = await readReply(socket);
    socket.destroy();
    return reply.startsWith("220");
  } catch {
    return false;
  }
}

function buildData(message: MailMessage): string {
  const headers = [
    `From: ${message.fromLine}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Message-ID: <${message.messageId}>`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    ``
  ].join("\r\n");
  return `${headers}${message.body.replace(/\n/g, "\r\n")}`;
}


type SmtpSocket = nodeNet.Socket;

function connect(env: Env): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const socket = nodeNet.createConnection({ host: env.smtpHost, port: env.smtpPort });
    socket.setTimeout(5_000);
    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new MailDownError());
    });
    socket.once("error", (err: NodeJS.ErrnoException) => {
      reject(err.code === "ECONNREFUSED" || err.code === "ECONNRESET" ? new MailDownError() : err);
    });
  });
}

function readReply(socket: SmtpSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      if (/\r\n$/.test(buffer) && /^\d{3}/.test(buffer)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err: NodeJS.ErrnoException) => {
      cleanup();
      reject(err.code === "ECONNRESET" ? new MailDownError() : err);
    };
    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function expectReply(socket: SmtpSocket, codes: number[]): Promise<string> {
  const reply = await readReply(socket);
  const code = Number(reply.slice(0, 3));
  if (!codes.includes(code)) {
    throw new Error(`unexpected SMTP reply: ${reply.trim()}`);
  }
  return reply;
}

async function command(socket: SmtpSocket, line: string, codes: number[]): Promise<void> {
  socket.write(`${line}\r\n`);
  await expectReply(socket, codes);
}
