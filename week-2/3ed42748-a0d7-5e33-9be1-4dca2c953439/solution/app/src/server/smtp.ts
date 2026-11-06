// A small SMTP client for Mailpit (no authentication). One connection per message.
import net from "node:net";
import { config } from "./config";

const TIMEOUT_MS = 5000;

class Conversation {
  private buffer = "";
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;
  private error: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
  }

  private drain(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]!;
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        this.buffer = lines.slice(i + 1).join("\r\n");
        const resolve = this.waiting;
        this.waiting = null;
        resolve?.({ code: Number(line.slice(0, 3)), text: line });
        return;
      }
    }
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      if (this.error) return reject(this.error);
      this.waiting = resolve;
      this.failed = reject;
      this.drain();
    });
  }

  fail(error: Error): void {
    this.error ??= error;
    const reject = this.failed;
    this.waiting = null;
    this.failed = null;
    reject?.(error);
  }

  async command(line: string, expect: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    const r = await this.reply();
    if (Math.floor(r.code / 100) !== Math.floor(expect / 100)) throw new Error(`unexpected reply ${r.code}`);
  }
}

function open(): Promise<{ socket: net.Socket; talk: Conversation }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    const talk = new Conversation(socket);
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("timeout")));
    socket.on("error", (error) => {
      talk.fail(error);
      reject(error);
    });
    socket.once("close", () => talk.fail(new Error("closed")));
    socket.once("connect", () => resolve({ socket, talk }));
  });
}

async function session<T>(work: (talk: Conversation) => Promise<T>): Promise<T> {
  const { socket, talk } = await open();
  try {
    const greeting = await talk.reply();
    if (greeting.code !== 220) throw new Error("no greeting");
    await talk.command("EHLO kitefold.example", 250);
    const result = await work(talk);
    await talk.command("QUIT", 221).catch(() => undefined);
    return result;
  } finally {
    socket.destroy();
  }
}

/** Sends one message; resolves once the mail server has accepted it. */
export async function sendMessage(envelopeFrom: string, to: string, message: string): Promise<void> {
  await session(async (talk) => {
    await talk.command(`MAIL FROM:<${envelopeFrom}>`, 250);
    await talk.command(`RCPT TO:<${to}>`, 250);
    await talk.command("DATA", 354);
    const stuffed = message.replace(/\r\n\./g, "\r\n..");
    await talk.command(`${stuffed}\r\n.`, 250);
  });
}

/** Opens a conversation and says goodbye: is the post office answering? */
export async function probeMailServer(): Promise<void> {
  await session(async () => undefined);
}
