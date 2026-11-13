// SMTP delivery to Mailpit: one recipient per message, UTF-8 text, an optional PDF attachment.
import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

type Email = { to: string; subject: string; text: string; attachment?: { filename: string; content: Buffer } };

function address(value: string): string {
  return /<([^>]+)>/.exec(value)?.[1] ?? value.trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64Lines(content: Buffer): string {
  return (content.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function fromHeader(): string {
  const match = /^(.*)<([^>]+)>\s*$/.exec(config.smtp.from);
  return match ? `${encodeHeader((match[1] ?? "").trim())} <${match[2]}>` : config.smtp.from;
}

/** The message as sent; the receiving server stamps its arrival time, which orders codes sent within one second. */
function compose(email: Email): string {
  const boundary = `gw-${randomUUID()}`;
  const headers = [
    `From: ${fromHeader()}`,
    `To: <${email.to}>`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Message-ID: <${randomUUID()}@gloamwork.test>`,
    "MIME-Version: 1.0",
  ];
  const textPart = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(Buffer.from(email.text, "utf8"))];
  if (!email.attachment) return [...headers, ...textPart].join("\r\n");
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPart,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${email.attachment.filename}"`,
    `Content-Disposition: attachment; filename="${email.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(email.attachment.content),
    `--${boundary}--`,
  ].join("\r\n");
}

/** Runs one SMTP conversation; each step waits for its reply code. */
async function converse(steps: { send: string | null; expect: number }[]): Promise<void> {
  const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(10_000);
  let buffer = "";
  const waiters: ((line: string) => void)[] = [];
  const failed = new Promise<never>((_, reject) => {
    socket.once("error", () => reject(new ApiError("email_unavailable")));
    socket.once("timeout", () => reject(new ApiError("email_unavailable")));
    socket.once("close", () => reject(new ApiError("email_unavailable")));
  });
  failed.catch(() => undefined);
  socket.on("data", (data: Buffer) => {
    buffer += data.toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (/^\d{3} /.test(line)) waiters.shift()?.(line);
    }
  });
  const reply = (): Promise<string> => Promise.race([new Promise<string>((resolve) => waiters.push(resolve)), failed]);
  try {
    for (const step of steps) {
      const waiting = reply();
      if (step.send !== null) socket.write(`${step.send}\r\n`);
      const line = await waiting;
      if (Number(line.slice(0, 3)) !== step.expect) throw new ApiError("email_unavailable");
    }
  } finally {
    socket.destroy();
  }
}

export async function sendEmail(email: Email): Promise<void> {
  const data = compose(email).replace(/^\./gm, "..");
  await converse([
    { send: null, expect: 220 },
    { send: "EHLO gloamwork.test", expect: 250 },
    { send: `MAIL FROM:<${address(config.smtp.from)}>`, expect: 250 },
    { send: `RCPT TO:<${email.to}>`, expect: 250 },
    { send: "DATA", expect: 354 },
    { send: `${data}\r\n.`, expect: 250 },
    { send: "QUIT", expect: 221 },
  ]);
}

/** Opens and closes an SMTP session without sending, to learn whether Mailpit accepts connections. */
export async function emailReachable(): Promise<boolean> {
  try {
    await converse([
      { send: null, expect: 220 },
      { send: "EHLO gloamwork.test", expect: 250 },
      { send: "QUIT", expect: 221 },
    ]);
    return true;
  } catch {
    return false;
  }
}
