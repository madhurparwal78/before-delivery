// A minimal SMTP client for Mailpit: plain, no authentication, one message per connection.
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { config } from "./config";
import { MailUnavailable } from "./errors";

const TIMEOUT_MS = 10_000;

function address(mailbox: string): string {
  const open = mailbox.indexOf("<");
  return open < 0 ? mailbox.trim() : mailbox.slice(open + 1, mailbox.indexOf(">"));
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function wrapBase64(text: string): string {
  return (Buffer.from(text).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Sends one plain-text message; throws MailUnavailable when the server does not accept it. */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const message = [
    `From: ${config.smtp.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@tinework>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(text),
  ].join("\r\n");
  const socket = connect({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(TIMEOUT_MS);
  let buffered = "";
  const waiting: ((reply: string) => void)[] = [];
  const failed: ((error: Error) => void)[] = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffered += chunk;
    for (;;) {
      const end = buffered.search(/^\d{3} .*\r?\n/m);
      if (end < 0) return;
      const line = buffered.slice(end, buffered.indexOf("\n", end) + 1);
      const reply = buffered.slice(0, end + line.length);
      buffered = buffered.slice(reply.length);
      waiting.shift()?.(reply);
    }
  });
  const fail = (error: Error) => failed.splice(0).forEach((reject) => reject(error));
  socket.on("error", fail);
  socket.on("timeout", () => fail(new Error("smtp timeout")));
  socket.on("close", () => fail(new Error("smtp connection closed")));
  const expect = (code: string) =>
    new Promise<void>((resolve, reject) => {
      failed.push(reject);
      waiting.push((reply) => {
        failed.length = 0;
        if (reply.startsWith(code)) resolve();
        else reject(new Error(`smtp: ${reply.trim()}`));
      });
    });
  const command = async (line: string, code: string) => {
    const answer = expect(code);
    socket.write(`${line}\r\n`);
    await answer;
  };
  try {
    await expect("220");
    await command("EHLO tinework", "250");
    await command(`MAIL FROM:<${address(config.smtp.from)}>`, "250");
    await command(`RCPT TO:<${address(to)}>`, "250");
    await command("DATA", "354");
    await command(`${message}\r\n.`, "250");
    await command("QUIT", "221");
  } catch (error) {
    throw new MailUnavailable((error as Error).message);
  } finally {
    socket.destroy();
  }
}
