import { connect, type Socket } from "node:net";
import { config } from "./config.ts";

/** A minimal SMTP client for the mail relay: plain SMTP, one message per connection. */
class Conversation {
  private buffer = "";
  private waiting: ((response: string) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    const fail = (error: Error) => this.failure?.(error);
    socket.on("error", fail);
    socket.on("timeout", () => fail(new Error("SMTP timeout")));
    socket.on("close", () => fail(new Error("SMTP connection closed")));
  }

  private deliver(): void {
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i]) && this.waiting) {
        const response = lines.slice(0, i + 1).join("\n");
        this.buffer = lines.slice(i + 1).join("\r\n");
        const resolve = this.waiting;
        this.waiting = null;
        resolve(response);
        return;
      }
    }
  }

  expect(code: string, command?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiting = (response) => (response.startsWith(code) ? resolve(response) : reject(new Error(response)));
      this.failure = reject;
      if (command !== undefined) this.socket.write(`${command}\r\n`);
      this.deliver();
    });
  }
}

function open(timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port, timeout: timeoutMs });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("SMTP connect timeout"));
    });
  });
}

function envelopeAddress(header: string): string {
  const m = /<([^>]+)>/.exec(header);
  return (m ? m[1] : header).trim();
}

export async function sendMessage(to: string, message: string): Promise<void> {
  const socket = await open(10_000);
  const smtp = new Conversation(socket);
  try {
    await smtp.expect("220");
    await smtp.expect("250", "EHLO strata.quarrystone.test");
    await smtp.expect("250", `MAIL FROM:<${envelopeAddress(config.mailFrom)}>`);
    await smtp.expect("250", `RCPT TO:<${to}>`);
    await smtp.expect("354", "DATA");
    const stuffed = message.split("\r\n").map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
    await smtp.expect("250", `${stuffed}\r\n.`);
    await smtp.expect("221", "QUIT").catch(() => undefined);
  } finally {
    socket.destroy();
  }
}

/** Health probe: the relay answers its greeting. */
export async function probeRelay(): Promise<boolean> {
  try {
    const socket = await open(3_000);
    const smtp = new Conversation(socket);
    try {
      await smtp.expect("220");
      return true;
    } finally {
      socket.destroy();
    }
  } catch {
    return false;
  }
}
