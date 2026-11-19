// A small SMTP client: one message per connection, plain text, UTF-8.
import net from "node:net";
import { randomUUID } from "node:crypto";

interface MailMessage {
  host: string;
  port: number;
  fromHeader: string;
  to: string;
  subject: string;
  body: string;
}

function envelopeAddress(header: string): string {
  const open = header.indexOf("<");
  return open >= 0 ? header.slice(open + 1, header.indexOf(">", open)) : header.trim();
}

function senderDomain(header: string): string {
  return envelopeAddress(header).split("@")[1] ?? "localhost";
}

function encodedWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function render(message: MailMessage): string {
  const body = Buffer.from(message.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${message.fromHeader}`,
    `To: ${message.to}`,
    `Subject: ${encodedWord(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${senderDomain(message.fromHeader)}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
    "",
  ].join("\r\n");
}

export function sendMail(message: MailMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: message.host, port: message.port });
    socket.setTimeout(10_000, () => fail(new Error("SMTP timeout")));
    let buffer = "";
    let waiting: ((code: number) => void) | null = null;
    let finished = false;

    function fail(error: Error): void {
      if (finished) return;
      finished = true;
      socket.destroy();
      reject(error);
    }

    socket.on("error", fail);
    socket.on("close", () => fail(new Error("SMTP connection closed")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      const last = lines.filter((line) => line.length > 0).pop();
      if (last && /^\d{3} /.test(last) && buffer.endsWith("\r\n")) {
        buffer = "";
        const callback = waiting;
        waiting = null;
        callback?.(Number(last.slice(0, 3)));
      }
    });

    const expect = (accepted: number): Promise<void> =>
      new Promise((ok, no) => {
        waiting = (code) => (code === accepted ? ok() : no(new Error(`SMTP answered ${code}, expected ${accepted}`)));
      });
    const command = async (line: string, accepted: number): Promise<void> => {
      const answer = expect(accepted);
      socket.write(`${line}\r\n`);
      await answer;
    };

    (async () => {
      await expect(220);
      await command("EHLO tramela-estate", 250);
      await command(`MAIL FROM:<${envelopeAddress(message.fromHeader)}>`, 250);
      await command(`RCPT TO:<${message.to}>`, 250);
      await command("DATA", 354);
      await command(`${render(message).replace(/^\./gm, "..")}\r\n.`, 250);
      await command("QUIT", 221).catch(() => undefined);
      finished = true;
      socket.destroy();
      resolve();
    })().catch(fail);
  });
}
