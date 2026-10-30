import { createConnection, type Socket } from "node:net";

import { config } from "./config";
import { newId } from "./tokens";

/** A save waits for its delivery attempt, and every API answer must come within two seconds. */
const TIMEOUT_MS = 1500;
/** The envelope sender is the address inside MAIL_FROM's angle brackets, or MAIL_FROM itself when it has none. */
const SENDER_ADDRESS = /<([^>]+)>/.exec(config.mailFrom)?.[1] ?? config.mailFrom;
const SENDER_DOMAIN = SENDER_ADDRESS.split("@").pop();

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Reads SMTP replies line by line; a reply ends at a line whose code is followed by a space. */
class Replies {
  private buffer = "";
  private waiting: Array<{ resolve: (reply: string) => void; reject: (error: Error) => void }> = [];
  private ready: string[] = [];
  private failure: Error | null = null;

  constructor(socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf("\r\n")) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) this.push(line);
      }
    });
    const fail = (error: Error) => {
      this.failure = error;
      this.waiting.splice(0).forEach((entry) => entry.reject(error));
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("SMTP connection closed")));
  }

  private push(line: string) {
    const next = this.waiting.shift();
    if (next) next.resolve(line);
    else this.ready.push(line);
  }

  next(): Promise<string> {
    const line = this.ready.shift();
    if (line) return Promise.resolve(line);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
}

const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

function message(mail: Mail) {
  const body = mail.text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return [
    `From: ${encodeHeader(config.mailFrom)}`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${newId()}@${SENDER_DOMAIN}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    ".",
    "",
  ].join("\r\n");
}

/** Whether this instance's mail server answers with a greeting right now. */
export async function smtpReachable(): Promise<boolean> {
  const socket = createConnection(config.smtp);
  socket.setTimeout(TIMEOUT_MS / 2, () => socket.destroy(new Error("SMTP timed out")));
  const replies = new Replies(socket);
  try {
    const greeting = await replies.next();
    socket.end("QUIT\r\n");
    return greeting.startsWith("220");
  } catch {
    socket.destroy();
    return false;
  }
}

/** Delivers one message over plain SMTP (Mailpit: no auth, no TLS). Rejects on any refusal or timeout. */
export async function sendMail(mail: Mail): Promise<void> {
  const socket = createConnection(config.smtp);
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timed out")));
  const replies = new Replies(socket);
  const expect = async (code: string) => {
    const reply = await replies.next();
    if (!reply.startsWith(code)) throw new Error(`SMTP refused: ${reply}`);
  };
  const command = async (line: string, code: string) => {
    socket.write(`${line}\r\n`);
    await expect(code);
  };
  try {
    await expect("220");
    await command(`EHLO ${SENDER_DOMAIN}`, "250");
    await command(`MAIL FROM:<${SENDER_ADDRESS}> BODY=8BITMIME`, "250");
    await command(`RCPT TO:<${mail.to}>`, "250");
    await command("DATA", "354");
    socket.write(message(mail));
    await expect("250");
    socket.end("QUIT\r\n");
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
