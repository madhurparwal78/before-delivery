import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { config } from "../config.js";

// A plain SMTP client for the provided mail service (no auth, no TLS), used only by the outbox.

const TIMEOUT_MS = 10_000;

const fromAddress = (): string => {
  const match = /<([^>]+)>/.exec(config.smtp.mailFrom);
  return (match?.[1] ?? config.smtp.mailFrom).trim();
};

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

/** Reads SMTP replies line by line and resolves each complete (possibly multi-line) reply. */
function replies(socket: Socket): () => Promise<{ code: number; text: string }> {
  let buffer = "";
  const waiting: ((reply: { code: number; text: string }) => void)[] = [];
  const ready: { code: number; text: string }[] = [];
  let lines: string[] = [];
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      lines.push(line);
      if (line.length < 4 || line[3] !== "-") {
        const reply = { code: parseInt(line.slice(0, 3), 10), text: lines.join("\n") };
        lines = [];
        const next = waiting.shift();
        if (next) next(reply);
        else ready.push(reply);
      }
    }
  });
  return () => {
    const reply = ready.shift();
    return reply ? Promise.resolve(reply) : new Promise((resolve) => waiting.push(resolve));
  };
}

interface Message {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(message: Message): Promise<void> {
  const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(TIMEOUT_MS);
  const failed = new Promise<never>((_, reject) => {
    socket.once("error", reject);
    socket.once("timeout", () => reject(new Error("smtp timeout")));
    socket.once("close", () => reject(new Error("smtp connection closed")));
  });
  const next = replies(socket);
  const expectCode = async (codes: number[]): Promise<void> => {
    const reply = await Promise.race([next(), failed]);
    if (!codes.includes(reply.code)) throw new Error(`smtp answered ${reply.text}`);
  };
  const command = async (line: string, codes: number[]): Promise<void> => {
    socket.write(`${line}\r\n`);
    await expectCode(codes);
  };
  try {
    await expectCode([220]);
    const sender = fromAddress();
    await command(`EHLO ${sender.split("@")[1] ?? "credwell"}`, [250]);
    await command(`MAIL FROM:<${sender}>`, [250]);
    await command(`RCPT TO:<${message.to}>`, [250, 251]);
    await command("DATA", [354]);
    const headers = [
      `From: ${config.smtp.mailFrom}`,
      `To: <${message.to}>`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
      `Message-ID: <${randomUUID()}@${sender.split("@")[1] ?? "credwell"}>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
    ];
    const body = message.text
      .replace(/\r?\n/g, "\r\n")
      .split("\r\n")
      .map((line) => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    await command(`${headers.join("\r\n")}\r\n\r\n${body}\r\n.`, [250]);
    socket.write("QUIT\r\n");
  } finally {
    failed.catch(() => undefined);
    socket.end();
  }
}
