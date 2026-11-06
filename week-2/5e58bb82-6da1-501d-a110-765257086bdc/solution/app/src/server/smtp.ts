// A minimal SMTP client for plain-text messages, one recipient per message.
import net from "node:net";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";

const TIMEOUT_MS = 5000;

class Conversation {
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    const fail = () => {
      this.failure = new Error("mail server unreachable");
      this.waiting?.("");
    };
    socket.on("error", fail);
    socket.on("close", fail);
  }

  private flush(): void {
    // A reply is complete at a line whose fourth character is a space ("250 OK").
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i]) && this.waiting) {
        const done = lines.slice(0, i + 1).join("\r\n");
        this.buffer = lines.slice(i + 1).join("\r\n");
        const resolve = this.waiting;
        this.waiting = null;
        resolve(done);
        return;
      }
    }
  }

  reply(expect: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting = (text) => {
        if (this.failure) reject(this.failure);
        else if (!text.startsWith(String(expect))) reject(new Error("mail server refused the message"));
        else resolve();
      };
      if (this.failure) this.waiting("");
      else this.flush();
    });
  }

  async send(line: string, expect: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.reply(expect);
  }
}

function open(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("timeout")));
    socket.once("connect", () => resolve(socket));
    socket.once("error", () => reject(new Error("mail server unreachable")));
  });
}

const addressOf = (value: string) => (value.includes("<") ? value.slice(value.indexOf("<") + 1, value.indexOf(">")) : value.trim());
const encodeWord = (text: string) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`);

interface Message {
  to: string;
  toName: string;
  subject: string;
  /** Lines joined with CR LF by the caller. */
  body: string;
}

export async function sendMail(message: Message): Promise<void> {
  const socket = await open();
  const talk = new Conversation(socket);
  try {
    await talk.reply(220);
    await talk.send("EHLO swathdeck", 250);
    await talk.send(`MAIL FROM:<${addressOf(config.smtp.from)}>`, 250);
    await talk.send(`RCPT TO:<${message.to}>`, 250);
    await talk.send("DATA", 354);
    const headers = [
      `From: ${config.smtp.from}`,
      `Reply-To: ${config.smtp.from}`,
      `To: ${encodeWord(message.toName)} <${message.to}>`,
      `Subject: ${encodeWord(message.subject)}`,
      `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
      `Message-ID: <${randomBytes(12).toString("hex")}@swathdeck>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
    ];
    const encoded = Buffer.from(message.body, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
    await talk.send(`${headers.join("\r\n")}\r\n\r\n${encoded}.`, 250);
    await talk.send("QUIT", 221).catch(() => undefined);
  } finally {
    socket.destroy();
  }
}

/** Whether the mail server answers its greeting. */
export async function mailReachable(): Promise<boolean> {
  try {
    const socket = await open();
    const talk = new Conversation(socket);
    try {
      await talk.reply(220);
      await talk.send("QUIT", 221).catch(() => undefined);
      return true;
    } finally {
      socket.destroy();
    }
  } catch {
    return false;
  }
}
