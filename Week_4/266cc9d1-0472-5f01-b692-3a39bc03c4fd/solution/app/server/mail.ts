// A minimal SMTP client for the mail sink: plain SMTP, no authentication.
import { randomBytes } from "node:crypto";
import { Socket } from "node:net";
import { config } from "./config.js";

export interface Email {
  to: string;
  subject: string;
  body: string;
}

const ATTEMPT_LIMIT_MS = 5_000;

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** One SMTP conversation; resolves once the server has accepted the message (or the probe's QUIT). */
function converse(steps: Array<{ send?: string; expect: number }>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let buffer = "";
    let index = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP attempt timed out"));
    }, ATTEMPT_LIMIT_MS);
    const finish = (error: Error | null): void => {
      clearTimeout(timer);
      socket.destroy();
      if (error === null) resolve();
      else reject(error);
    };
    socket.on("error", (error) => finish(error));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const step = steps[index];
        if (step === undefined) continue;
        if (code !== step.expect) {
          finish(new Error(`SMTP answered ${line}`));
          return;
        }
        index += 1;
        const next = steps[index];
        if (next === undefined) {
          socket.end("QUIT\r\n");
          finish(null);
          return;
        }
        if (next.send !== undefined) socket.write(next.send);
      }
    });
    socket.connect(config.mail.port, config.mail.host);
  });
}

export async function sendEmail(email: Email): Promise<void> {
  const from = address(config.mail.from);
  const domain = from.slice(from.indexOf("@") + 1);
  const body = email.body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  const message = [
    `From: ${config.mail.from}`,
    `To: ${email.to}`,
    `Subject: ${headerText(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
  await converse([
    { expect: 220 },
    { send: `EHLO ${domain}\r\n`, expect: 250 },
    { send: `MAIL FROM:<${from}>\r\n`, expect: 250 },
    { send: `RCPT TO:<${address(email.to)}>\r\n`, expect: 250 },
    { send: "DATA\r\n", expect: 354 },
    { send: `${message}\r\n.\r\n`, expect: 250 },
  ]);
}

/** Probe used by the service monitor: the server greets and answers EHLO. */
export async function probeMail(): Promise<void> {
  await converse([{ expect: 220 }, { send: "EHLO spanwise\r\n", expect: 250 }]);
}
