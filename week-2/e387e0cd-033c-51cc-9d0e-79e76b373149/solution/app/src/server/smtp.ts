// Outgoing mail over SMTP to the configured host and port (Mailpit). Mail never carries personal data.
import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { config } from "./config.js";

export interface Mail {
  to: string[];
  subject: string;
  text: string;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return (match ? match[1] : mailbox).trim();
}

/** One SMTP conversation: EHLO, MAIL FROM, RCPT TO, DATA, QUIT, each reply checked. */
function converse(lines: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const expected = [220, 250, 250, ...lines.slice(2, -3).map(() => 250), 354, 250, 221];
    let buffer = "";
    let step = 0;
    socket.setTimeout(10000, () => socket.destroy(new Error("SMTP timed out")));
    socket.on("error", reject);
    socket.on("close", () => (step >= expected.length ? resolve() : reject(new Error("SMTP closed early"))));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (code !== expected[step]) {
          socket.destroy(new Error(`SMTP said ${line}`));
          return;
        }
        if (step < lines.length) socket.write(lines[step]);
        step += 1;
        if (step === expected.length) socket.end();
      }
    });
    socket.connect(config.smtp.port, config.smtp.host);
  });
}

async function sendMail(mail: Mail): Promise<void> {
  const from = addressOf(config.smtp.from);
  const headers = [
    `From: ${config.smtp.from}`,
    `To: ${mail.to.join(", ")}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@lanternline.desk>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  const body = mail.text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  await converse([
    "EHLO lanternline.desk\r\n",
    `MAIL FROM:<${from}>\r\n`,
    ...mail.to.map((to) => `RCPT TO:<${addressOf(to)}>\r\n`),
    "DATA\r\n",
    `${headers.join("\r\n")}\r\n\r\n${body}\r\n.\r\n`,
    "QUIT\r\n",
  ]);
}

/** Sends after the record is committed; a failed send is retried a few times, never blocking the request. */
export function deliverLater(mail: Mail): void {
  const attempt = (left: number): void => {
    sendMail(mail).catch((error: unknown) => {
      if (left > 0) setTimeout(() => attempt(left - 1), 2000);
      else console.error(`mail "${mail.subject}" was not delivered`, error);
    });
  };
  attempt(3);
}
