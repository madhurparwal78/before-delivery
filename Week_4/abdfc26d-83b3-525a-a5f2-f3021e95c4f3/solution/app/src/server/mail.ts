import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

interface Email {
  to: string;
  subject: string;
  text: string;
  attachment: { name: string; data: Buffer } | null;
}

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

const base64Lines = (data: Buffer): string => data.toString("base64").replace(/.{76}/g, "$&\r\n");

function fromHeader(): string {
  const match = /^(.*)<([^>]+)>\s*$/.exec(config.smtp.from);
  return match ? `${encodeHeader((match[1] ?? "").trim())} <${match[2]}>` : config.smtp.from;
}

function render(email: Email): string {
  const head = [
    `From: ${fromHeader()}`,
    `To: <${email.to}>`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@brightmoss.example>`,
    "MIME-Version: 1.0",
  ];
  const text = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(Buffer.from(email.text, "utf8"))];
  if (!email.attachment) return [...head, ...text].join("\r\n");
  const boundary = `py-${randomUUID()}`;
  const name = email.attachment.name.replace(/["\\\r\n]/g, "");
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...text,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(email.attachment.data),
    `--${boundary}--`,
  ].join("\r\n");
}

/** Sends one message over plain SMTP; resolves only once the server accepted it. */
export function sendMail(email: Email): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(15_000);
    const steps = [
      "EHLO phosphene-yard",
      `MAIL FROM:<${config.smtp.envelopeFrom}>`,
      `RCPT TO:<${email.to}>`,
      "DATA",
      `${render(email).replace(/\r\n\./g, "\r\n..")}\r\n.`,
      "QUIT",
    ];
    let buffer = "";
    let step = -1;
    let accepted = false;
    const fail = (detail: string) => {
      socket.destroy();
      if (accepted) resolve();
      else reject(new ProviderDown("mail", detail));
    };
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        if (Number(line.slice(0, 3)) >= 400) return fail(line);
        step += 1;
        // the reply after the message body (step 5) means the server accepted it
        if (step === 5) accepted = true;
        if (step >= steps.length) {
          socket.end();
          return resolve();
        }
        socket.write(`${steps[step]}\r\n`);
      }
    });
    socket.on("timeout", () => fail("timeout"));
    socket.on("error", (error) => fail(error.message));
  });
}

export function reachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(3000);
    socket.once("data", (chunk: Buffer) => {
      socket.end("QUIT\r\n");
      resolve(chunk.toString("utf8").startsWith("220"));
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}
