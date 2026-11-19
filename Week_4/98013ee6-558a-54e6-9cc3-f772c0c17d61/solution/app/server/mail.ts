import net from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

const headerSafe = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();

function encodeHeader(value: string): string {
  const safe = headerSafe(value);
  return /^[\x20-\x7e]*$/.test(safe) ? safe : `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

function envelopeAddress(address: string): string {
  const match = /<([^>]+)>/.exec(address);
  return (match?.[1] ?? address).trim();
}

function lineReader(socket: net.Socket): () => Promise<string> {
  let buffer = "";
  const waiting: ((line: string) => void)[] = [];
  const lines: string[] = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\r\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const next = waiting.shift();
      if (next) next(line);
      else lines.push(line);
      index = buffer.indexOf("\r\n");
    }
  });
  return () => {
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve) => waiting.push(resolve));
  };
}

/** Sends one plain-text message through the configured SMTP host (Mailpit in development). */
async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(10_000, () => socket.destroy(new Error("smtp timeout")));
  const failed = new Promise<never>((_resolve, reject) => {
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("smtp connection closed")));
  });
  failed.catch(() => undefined);
  const readLine = lineReader(socket);
  const expect = async (code: string): Promise<void> => {
    let line = await Promise.race([readLine(), failed]);
    while (line.length >= 4 && line[3] === "-") line = await Promise.race([readLine(), failed]);
    if (!line.startsWith(code)) throw new Error(`smtp expected ${code}, got ${line}`);
  };
  const say = async (command: string, code: string): Promise<void> => {
    socket.write(`${command}\r\n`);
    await expect(code);
  };
  try {
    await expect("220");
    await say("EHLO mothlight", "250");
    await say(`MAIL FROM:<${envelopeAddress(config.smtp.from)}>`, "250");
    await say(`RCPT TO:<${envelopeAddress(to)}>`, "250");
    await say("DATA", "354");
    const body = Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
    const message = [
      `From: ${headerSafe(config.smtp.from)}`,
      `To: ${headerSafe(to)}`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@mothlight>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
      ".",
    ].join("\r\n");
    await say(message, "250");
    await say("QUIT", "221");
  } finally {
    socket.destroy();
  }
}

/** Mail is handed over in the background; a failure is logged and never changes the API reply. */
export function sendMailInBackground(to: string, subject: string, text: string): void {
  sendMail(to, subject, text).catch((error: unknown) => console.error("mail not delivered", String(error)));
}
