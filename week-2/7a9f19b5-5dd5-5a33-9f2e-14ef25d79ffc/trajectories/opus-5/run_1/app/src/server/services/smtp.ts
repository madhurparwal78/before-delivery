/**
 * A plain SMTP client for Mailpit. Messages are sent as multipart/mixed holding a
 * multipart/alternative text and HTML pair, plus any attachments.
 *
 * Writing this here keeps the shipped dependency tree to packages under the
 * licences the project allows, and keeps the SMTP conversation explicit.
 */

import { createConnection, type Socket } from "node:net";
import { randomBytes } from "node:crypto";

export interface SmtpAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: readonly SmtpAttachment[];
}

/** Reads replies line by line and resolves on each complete SMTP response. */
class SmtpConnection {
  private buffer = "";
  private pending: { resolve: (reply: string) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("the SMTP connection closed")));
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiter = this.pending;
    this.pending = null;
    waiter?.reject(error);
  }

  /** A reply ends at the line whose fourth character is a space, not a hyphen. */
  private drain(): void {
    if (!this.pending) return;
    const lines = this.buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i += 1) {
      const line = lines[i] as string;
      if (line.length >= 4 && line[3] === "-") continue;
      const reply = lines.slice(0, i + 1).join("\r\n");
      this.buffer = lines.slice(i + 1).join("\r\n");
      const waiter = this.pending;
      this.pending = null;
      waiter?.resolve(reply);
      return;
    }
  }

  read(): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.drain();
    });
  }

  write(line: string): void {
    this.socket.write(line);
  }

  end(): void {
    this.socket.destroy();
  }
}

function expect(reply: string, codes: readonly number[]): void {
  const code = Number(reply.slice(0, 3));
  if (!codes.includes(code)) throw new Error(`SMTP replied ${reply.split("\r\n")[0]}`);
}

/** `Southerly Light Works <lightfall@x.test>` -> `lightfall@x.test`. */
export function addressOf(mailbox: string): string {
  const angled = /<([^>]+)>/.exec(mailbox);
  return (angled?.[1] ?? mailbox).trim();
}

const needsEncoding = (value: string): boolean => /[^\t\u0020-\u007e]/.test(value);

/** RFC 2047 encodes a header value only when it carries non-ASCII characters. */
function encodeHeader(value: string): string {
  if (!needsEncoding(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Splits base64 into the 76-character lines MIME expects. */
function base64Lines(content: Buffer): string {
  const encoded = content.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76));
  return lines.join("\r\n");
}

export function buildMimeMessage(message: SmtpMessage): string {
  const boundaryMixed = `lf-mixed-${randomBytes(12).toString("hex")}`;
  const boundaryAlt = `lf-alt-${randomBytes(12).toString("hex")}`;
  const attachments = message.attachments ?? [];

  const headers = [
    `From: ${needsEncoding(message.from) ? rewriteDisplayName(message.from) : message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@lightfall>`,
    "MIME-Version: 1.0",
  ];

  const alternative = [
    `--${boundaryAlt}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(message.text, "utf8")),
    `--${boundaryAlt}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(message.html, "utf8")),
    `--${boundaryAlt}--`,
  ];

  const parts = [
    `--${boundaryMixed}`,
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
    "",
    ...alternative,
  ];

  for (const attachment of attachments) {
    parts.push(
      `--${boundaryMixed}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      base64Lines(attachment.content),
    );
  }
  parts.push(`--${boundaryMixed}--`);

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`,
    "",
    ...parts,
    "",
  ].join("\r\n");
}

/** Encodes only the display name, leaving the angle-addr intact. */
function rewriteDisplayName(mailbox: string): string {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(mailbox);
  if (!match) return encodeHeader(mailbox);
  return `${encodeHeader((match[1] ?? "").replace(/^"|"$/g, ""))} <${match[2]}>`;
}

/** Dot-stuffing: a body line starting with a dot is escaped so it is not the terminator. */
function stuffDots(body: string): string {
  return body
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

async function connect(host: string, port: number, timeoutMs: number): Promise<SmtpConnection> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const pending = createConnection({ host, port });
    pending.setTimeout(timeoutMs, () => {
      pending.destroy();
      reject(new Error("the SMTP connection timed out"));
    });
    pending.once("connect", () => {
      pending.setTimeout(0);
      resolve(pending);
    });
    pending.once("error", reject);
  });
  return new SmtpConnection(socket);
}

export async function sendMail(
  options: { host: string; port: number; timeoutMs: number },
  message: SmtpMessage,
): Promise<void> {
  const connection = await connect(options.host, options.port, options.timeoutMs);
  try {
    expect(await connection.read(), [220]);
    connection.write("EHLO lightfall\r\n");
    expect(await connection.read(), [250]);

    connection.write(`MAIL FROM:<${addressOf(message.from)}>\r\n`);
    expect(await connection.read(), [250]);
    connection.write(`RCPT TO:<${addressOf(message.to)}>\r\n`);
    expect(await connection.read(), [250, 251]);

    connection.write("DATA\r\n");
    expect(await connection.read(), [354]);
    connection.write(`${stuffDots(buildMimeMessage(message))}\r\n.\r\n`);
    expect(await connection.read(), [250]);

    connection.write("QUIT\r\n");
  } finally {
    connection.end();
  }
}

/** Opens an SMTP conversation and closes it, which is the health probe. */
export async function probe(options: { host: string; port: number; timeoutMs: number }): Promise<void> {
  const connection = await connect(options.host, options.port, options.timeoutMs);
  try {
    expect(await connection.read(), [220]);
    connection.write("EHLO lightfall\r\n");
    expect(await connection.read(), [250]);
    connection.write("QUIT\r\n");
  } finally {
    connection.end();
  }
}
