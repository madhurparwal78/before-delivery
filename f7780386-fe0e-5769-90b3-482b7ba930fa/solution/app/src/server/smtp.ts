// A minimal SMTP client for the mail sink: EHLO, MAIL FROM, RCPT TO, DATA, QUIT over plain TCP.

import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import type { Config } from "./config.js";

const MAIL_FROM_ADDRESS = "passboard@halsted-kitchen.test";
const MAIL_FROM = `Passboard <${MAIL_FROM_ADDRESS}>`;

let settings: Config["smtp"] | null = null;

export function configureSmtp(smtp: Config["smtp"]): void {
  settings = smtp;
}

interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  sentAt: Date;
}

/** RFC 2047 encoded words for a header holding non-ASCII text, split on character boundaries. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, "utf8") > 42) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
  return words.join("\r\n ");
}

function message(mail: OutgoingMail): string {
  const body = Buffer.from(mail.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${MAIL_FROM}`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${mail.sentAt.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@halsted-kitchen.test>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

export function sendMail(mail: OutgoingMail): Promise<void> {
  const smtp = settings;
  if (!smtp) return Promise.reject(new Error("smtp not configured"));
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const steps = [
      "EHLO passboard",
      `MAIL FROM:<${MAIL_FROM_ADDRESS}>`,
      `RCPT TO:<${mail.to}>`,
      "DATA",
      `${message(mail).replace(/^\./gm, "..")}\r\n.`,
      "QUIT",
    ];
    const expected = ["220", "250", "250", "250", "354", "250", "221"];
    let step = 0;
    let buffer = "";
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(10_000, () => fail(new Error("smtp timeout")));
    socket.on("error", fail);
    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line[3] === "-") continue;
        if (!line.startsWith(expected[step] ?? "")) {
          fail(new Error(`smtp refused: ${line.slice(0, 3)}`));
          return;
        }
        if (step === steps.length) {
          socket.end();
          resolve();
          return;
        }
        socket.write(`${steps[step]}\r\n`);
        step += 1;
      }
    });
    socket.connect(smtp.port, smtp.host);
  });
}
