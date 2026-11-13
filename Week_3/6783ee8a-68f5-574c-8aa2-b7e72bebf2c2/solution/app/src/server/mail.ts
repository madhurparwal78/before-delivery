import { connect } from "node:net";
import { settings } from "./config";

export class MailUnavailable extends Error {}

const TIMEOUT_MS = 8000;

function addressOf(from: string): string {
  const open = from.indexOf("<");
  return open === -1 ? from.trim() : from.slice(open + 1, from.indexOf(">"));
}

function encodedHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function message(to: string, subject: string, text: string): string {
  const body = Buffer.from(text, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${settings.smtp.from}`,
    `To: ${to}`,
    `Subject: ${encodedHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Sends one plain text email through the SMTP server named by SMTP_HOST and SMTP_PORT. */
export function sendMail(to: string, subject: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(settings.smtp.port, settings.smtp.host);
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timed out")));
    let buffer = "";
    let waiting: ((code: number) => void) | null = null;
    const fail = (error: Error): void => reject(new MailUnavailable(error.message));
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("SMTP closed early")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const last = buffer.split("\r\n").filter((line) => /^\d{3} /.test(line)).pop();
      if (last && waiting) {
        const done = waiting;
        waiting = null;
        buffer = "";
        done(Number(last.slice(0, 3)));
      }
    });
    const expect = (code: number): Promise<void> =>
      new Promise((ok, no) => {
        waiting = (got) => (got === code ? ok() : no(new Error(`SMTP answered ${got}, expected ${code}`)));
      });
    const say = async (line: string, code: number): Promise<void> => {
      const answer = expect(code);
      socket.write(`${line}\r\n`);
      await answer;
    };
    (async () => {
      await expect(220);
      await say("EHLO brackenpad", 250);
      await say(`MAIL FROM:<${addressOf(settings.smtp.from)}>`, 250);
      await say(`RCPT TO:<${to}>`, 250);
      await say("DATA", 354);
      await say(`${message(to, subject, text)}\r\n.`, 250);
      socket.write("QUIT\r\n");
      socket.removeAllListeners("close");
      socket.end();
      resolve();
    })().catch((error: Error) => {
      socket.destroy();
      fail(error);
    });
  });
}
