import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "../config";
import { report } from "./status";

const TIMEOUT_MS = 5000;

export class MailError extends Error {}

const FROM_ADDRESS = (() => {
  const match = /<([^>]+)>/.exec(config.smtp.from);
  return match?.[1] ?? config.smtp.from.trim();
})();

/** Reads SMTP replies line by line; a reply ends at the first line whose fourth character is a space. */
class Dialogue {
  private buffer = "";
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("smtp timeout")));
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.flush();
    });
    socket.on("close", () => {
      this.failure ??= new Error("smtp connection closed");
      this.flush();
    });
  }

  private flush(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split("\r\n");
    const last = lines.findIndex((line) => /^\d{3}( |$)/.test(line));
    if (last >= 0) {
      const consumed = lines.slice(0, last + 1);
      this.buffer = lines.slice(last + 1).join("\r\n");
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ code: Number(consumed[last]?.slice(0, 3)), text: consumed.join("\n") });
    } else if (this.failure) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ code: 0, text: this.failure.message });
    }
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.flush();
    });
  }

  async expect(code: number): Promise<void> {
    const reply = await this.reply();
    if (reply.code !== code) throw new MailError(`smtp expected ${code}, got ${reply.text}`);
  }

  async command(line: string, code: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(code);
  }
}

async function converse(work: (dialogue: Dialogue) => Promise<void>): Promise<void> {
  const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
  const dialogue = new Dialogue(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    await dialogue.expect(220);
    await dialogue.command("EHLO pinsheet", 250);
    await work(dialogue);
    socket.write("QUIT\r\n");
    report("mail", true);
  } catch (error) {
    report("mail", false);
    throw error instanceof MailError ? error : new MailError(error instanceof Error ? error.message : "smtp unreachable");
  } finally {
    socket.destroy();
  }
}

const header = (value: string): string => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`);

interface Mail {
  to: string;
  subject: string;
  text: string;
}

export function send(mail: Mail): Promise<void> {
  const body = Buffer.from(mail.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const message = [
    `From: ${config.smtp.from}`,
    `To: <${mail.to}>`,
    `Subject: ${header(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@pinsheet>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
  return converse(async (dialogue) => {
    await dialogue.command(`MAIL FROM:<${FROM_ADDRESS}>`, 250);
    await dialogue.command(`RCPT TO:<${mail.to}>`, 250);
    await dialogue.command("DATA", 354);
    await dialogue.command(`${message}\r\n.`, 250);
  });
}

export function ping(): Promise<void> {
  return converse(async () => undefined);
}
