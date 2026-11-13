import net from "node:net";
import { config } from "./config";
import { ApiError } from "./errors";
import { now } from "./clock";

const SMTP_TIMEOUT_MS = 5000;

interface Reply {
  code: number;
  last: boolean;
}

/** One SMTP conversation with Mailpit: connects, greets, sends one text message, quits. */
class Conversation {
  private buffer = "";
  private waiting: ((reply: Reply) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.receive(chunk));
    socket.on("error", (error) => this.failed?.(error));
    socket.on("close", () => this.failed?.(new Error("connection closed")));
    socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error("timeout")));
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    for (let end = this.buffer.indexOf("\r\n"); end >= 0; end = this.buffer.indexOf("\r\n")) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const reply = { code: Number(line.slice(0, 3)), last: line[3] !== "-" };
      if (reply.last) this.waiting?.(reply);
    }
  }

  expect(code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.failed = reject;
      this.waiting = (reply) => (reply.code === code ? resolve() : reject(new Error(`SMTP ${reply.code}`)));
    });
  }

  async command(line: string, code: number): Promise<void> {
    const reply = this.expect(code);
    this.socket.write(`${line}\r\n`);
    await reply;
  }
}

async function open(): Promise<{ socket: net.Socket; conversation: Conversation }> {
  const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
  const conversation = new Conversation(socket);
  await conversation.expect(220);
  return { socket, conversation };
}

function envelopeAddress(from: string): string {
  const open = from.indexOf("<");
  return open >= 0 ? from.slice(open + 1, from.indexOf(">")) : from.trim();
}

/** Resolves once Mailpit has accepted the message; any failure to reach or talk to it is MAIL_UNAVAILABLE. */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  try {
    const { socket, conversation } = await open();
    try {
      await conversation.command("EHLO seam", 250);
      await conversation.command(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, 250);
      await conversation.command(`RCPT TO:<${to}>`, 250);
      await conversation.command("DATA", 354);
      const headers = [
        `From: ${config.mailFrom}`,
        `To: <${to}>`,
        `Subject: ${subject}`,
        `Date: ${now().toUTCString()}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
      ];
      const body = text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
      await conversation.command(`${headers.join("\r\n")}\r\n\r\n${body}\r\n.`, 250);
      await conversation.command("QUIT", 221);
    } finally {
      socket.destroy();
    }
  } catch {
    throw new ApiError("MAIL_UNAVAILABLE");
  }
}

/** True when Mailpit's SMTP port answers with its greeting. */
export async function mailReachable(): Promise<boolean> {
  try {
    const { socket } = await open();
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}
