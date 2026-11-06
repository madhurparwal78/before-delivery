// Plain-text notices over SMTP (Mailpit in development and grading). Messages never carry a prompt,
// script, input value, input media link or signing secret: callers pass only the facts the brief lists.

import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { config } from "../config";
import { reason } from "../log";

const { host, port, from } = config.mail;
const SEND_ATTEMPTS = 3;

interface Mail {
  to: string[];
  subject: string;
  text: string;
}

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1] : value).trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Reads SMTP replies line by line; a reply ends at a line whose fourth character is a space. */
function conversation(socket: Socket): (command: string | null, expect: number) => Promise<void> {
  let buffer = "";
  const waiting: Array<(line: string) => void> = [];
  const lines: string[] = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let at: number;
    while ((at = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (line.charAt(3) === "-") continue;
      const next = waiting.shift();
      if (next) next(line);
      else lines.push(line);
    }
  });
  const reply = (): Promise<string> => {
    const ready = lines.shift();
    return ready !== undefined ? Promise.resolve(ready) : new Promise((resolve) => waiting.push(resolve));
  };
  return async (command, expect) => {
    if (command !== null) socket.write(`${command}\r\n`);
    const line = await reply();
    if (Number(line.slice(0, 3)) !== expect) throw new Error(`SMTP answered ${line.slice(0, 3)} where ${expect} was expected`);
  };
}

async function deliver(mail: Mail): Promise<void> {
  const socket = connect({ host, port });
  socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP timed out")));
  const failed = new Promise<never>((_, reject) => socket.once("error", reject));
  failed.catch(() => undefined);
  const step = conversation(socket);
  const body = [
    `From: ${from}`,
    `To: ${mail.to.join(", ")}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${address(from).split("@")[1] ?? "dispatch"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    ...mail.text.split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line)),
  ].join("\r\n");
  const dialogue = async (): Promise<void> => {
    await step(null, 220);
    await step("EHLO dispatch.local", 250);
    await step(`MAIL FROM:<${address(from)}>`, 250);
    for (const to of mail.to) await step(`RCPT TO:<${to}>`, 250);
    await step("DATA", 354);
    await step(`${body}\r\n.`, 250);
    await step("QUIT", 221);
  };
  try {
    await Promise.race([dialogue(), failed]);
  } finally {
    socket.end();
  }
}

/** Sends in the background with a few attempts; a mail failure never fails the action that caused it. */
export function sendMail(mail: Mail): void {
  if (!mail.to.length) return;
  const attempt = (n: number): void => {
    deliver(mail).catch((error: unknown) => {
      if (n < SEND_ATTEMPTS) setTimeout(() => attempt(n + 1), 2_000 * n);
      else console.error(`mail "${mail.subject}" was not sent: ${reason(error)}`);
    });
  };
  attempt(1);
}
