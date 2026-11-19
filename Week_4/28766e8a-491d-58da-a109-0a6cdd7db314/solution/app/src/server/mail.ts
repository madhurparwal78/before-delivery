// Mail over SMTP to Mailpit (brief: Services, Mailpit). Every message has exactly one recipient and
// a single-line subject; every send opens a fresh connection so mail recovers without a restart.
import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { hasControl } from "../shared/text";
import { config } from "./config";

const TIMEOUT_MS = 10000;

function fromAddress(): string {
  const match = /<([^>]+)>/.exec(config.mailFrom);
  return (match?.[1] ?? config.mailFrom).trim();
}

function headerText(value: string): string {
  if (hasControl(value)) throw new Error("header value carries a control character");
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Reads one complete (possibly multi-line) SMTP reply and returns its code. */
function reply(socket: Socket, buffer: { text: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const lines = buffer.text.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i] as string;
        if (/^\d{3} /.test(line)) {
          buffer.text = lines.slice(i + 1).join("\r\n");
          socket.off("data", onData);
          socket.off("error", onError);
          resolve(Number(line.slice(0, 3)));
          return;
        }
      }
    };
    const onData = (chunk: Buffer) => {
      buffer.text += chunk.toString("utf8");
      check();
    };
    const onError = (error: Error) => reject(error);
    socket.on("data", onData);
    socket.on("error", onError);
    check();
  });
}

/** Sends one plain-text message to one recipient; resolves false when the mail server is unreachable or refuses it. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  let socket: Socket | undefined;
  try {
    socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket?.destroy(new Error("smtp timeout")));
    const buffer = { text: "" };
    const step = async (line: string | null, expect: number) => {
      if (line !== null) socket?.write(`${line}\r\n`);
      const code = await reply(socket as Socket, buffer);
      if (Math.floor(code / 100) !== Math.floor(expect / 100)) throw new Error(`smtp ${code}`);
    };
    await new Promise<void>((resolve, reject) => {
      socket?.once("connect", resolve);
      socket?.once("error", reject);
    });
    await step(null, 220);
    await step("EHLO linewell", 250);
    await step(`MAIL FROM:<${fromAddress()}>`, 250);
    await step(`RCPT TO:<${to}>`, 250);
    await step("DATA", 354);
    const body = text.replace(/\r?\n/g, "\r\n").split("\r\n").map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
    const message = [
      `From: ${headerText(config.mailFrom)}`,
      `To: <${to}>`,
      `Subject: ${headerText(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@linewell>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      ".",
    ].join("\r\n");
    await step(message, 250);
    socket.write("QUIT\r\n");
    socket.end();
    return true;
  } catch {
    socket?.destroy();
    return false;
  }
}

export function diagramLink(diagramId: string): string {
  return `${config.publicUrl}/d/${diagramId}`;
}
