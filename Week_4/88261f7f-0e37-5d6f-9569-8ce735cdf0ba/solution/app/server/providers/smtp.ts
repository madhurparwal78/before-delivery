import { randomUUID } from "node:crypto";
import net from "node:net";
import { config, PROVIDER_TIMEOUT_MS } from "../config";

/** The mail service cannot be reached or refused the message. */
export class MailUnavailable extends Error {}

interface Attachment { fileName: string; contentType: string; bytes: Buffer }
interface Message { to: string; subject: string; text: string; attachment?: Attachment }

const ADDRESS = /<([^>]+)>/;

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function wrap(base64: string): string {
  return base64.replace(/.{76}/g, "$&\r\n");
}

function compose(message: Message): string {
  const from = config.mailFrom;
  const head = [
    `From: ${from}`, `To: ${message.to}`, `Subject: ${encodeHeader(message.subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@nightroll>`, "MIME-Version: 1.0",
  ];
  const text = Buffer.from(message.text).toString("base64");
  if (!message.attachment) {
    return [...head, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", wrap(text)].join("\r\n");
  }
  const boundary = `b-${randomUUID()}`;
  const { attachment } = message;
  return [
    ...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", wrap(text),
    `--${boundary}`, `Content-Type: ${attachment.contentType}; name="${attachment.fileName}"`,
    "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${attachment.fileName}"`, "",
    wrap(attachment.bytes.toString("base64")), `--${boundary}--`,
  ].join("\r\n");
}

/** One SMTP conversation: connect, hand the message over, wait for the server to accept it. */
export function sendMail(message: Message): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
    const fail = (): void => {
      socket.destroy();
      reject(new MailUnavailable());
    };
    socket.setTimeout(PROVIDER_TIMEOUT_MS, fail);
    socket.on("error", fail);
    const envelopeFrom = ADDRESS.exec(config.mailFrom)?.[1] ?? config.mailFrom;
    const body = compose(message).replace(/^\./gm, "..");
    const script = [
      `EHLO nightroll`, `MAIL FROM:<${envelopeFrom}>`, `RCPT TO:<${message.to}>`, "DATA", `${body}\r\n.`, "QUIT",
    ];
    const expected = [250, 250, 250, 354, 250, 221];
    let step = -1;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = line.slice(0, 3);
        const want = step < 0 ? 220 : expected[step];
        if (code !== String(want)) return fail();
        step += 1;
        const next = script[step];
        if (next === undefined) {
          socket.end();
          return resolve();
        }
        socket.write(`${next}\r\n`);
      }
    });
  });
}

export async function mailReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
    const done = (reachable: boolean): void => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(PROVIDER_TIMEOUT_MS, () => done(false));
    socket.on("error", () => done(false));
    socket.on("data", (chunk) => done(chunk.toString("utf8").startsWith("220")));
  });
}
