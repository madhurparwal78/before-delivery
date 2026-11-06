import { randomBytes } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import type { Db } from "./db.js";

/** Every email is queued in Postgres first; the outbox worker delivers it when mail is reachable. */
export async function queueEmail(db: Db, to: string, subject: string, body: string): Promise<void> {
  await db.query("INSERT INTO emails (to_address, subject, body, created_at) VALUES ($1, $2, $3, now())", [to, subject, body]);
}

const address = (value: string): string => /<([^>]+)>/.exec(value)?.[1] ?? value.trim();

const headerSafe = (value: string): string => {
  if (/[\r\n\0\u0085\u2028\u2029]/.test(value)) throw new RangeError("Header value contains a line break");
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
};

function message(to: string, subject: string, body: string): string {
  const encoded = Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${headerSafe(config.mail.from)}`,
    `To: ${headerSafe(to)}`,
    `Subject: ${headerSafe(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@hearthshift>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
  ].join("\r\n");
}

/** A plain SMTP conversation: one command at a time, each answered before the next. */
async function converse(commands: string[]): Promise<void> {
  const socket = net.connect({ host: config.mail.host, port: config.mail.port });
  socket.setTimeout(10000);
  let buffer = "";
  const waiters: ((line: string) => void)[] = [];
  const failures: ((error: Error) => void)[] = [];
  const reply = (): Promise<string> => new Promise((resolve, reject) => { waiters.push(resolve); failures.push(reject); });
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let end = buffer.indexOf("\r\n");
    while (end !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line)) {
        failures.shift();
        waiters.shift()?.(line);
      }
      end = buffer.indexOf("\r\n");
    }
  });
  const fail = (error: Error): void => { for (const reject of failures.splice(0)) reject(error); waiters.splice(0); };
  socket.on("error", fail);
  socket.on("timeout", () => { fail(new Error("SMTP timeout")); socket.destroy(); });
  socket.on("close", () => fail(new Error("SMTP connection closed")));
  try {
    const expect = async (codes: string[]): Promise<void> => {
      const line = await reply();
      if (!codes.some((code) => line.startsWith(code))) throw new Error(`SMTP refused: ${line.slice(0, 3)}`);
    };
    await expect(["220"]);
    for (const command of commands) {
      socket.write(`${command}\r\n`);
      await expect(command.startsWith("DATA") ? ["354"] : command.startsWith("QUIT") ? ["221"] : ["250", "251"]);
    }
  } finally {
    socket.destroy();
  }
}

export async function deliver(to: string, subject: string, body: string): Promise<void> {
  const data = message(to, subject, body).split("\r\n").map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
  await converse(["EHLO hearthshift", `MAIL FROM:<${address(config.mail.from)}>`, `RCPT TO:<${address(to)}>`, "DATA", `${data}\r\n.`, "QUIT"]);
}

/** Health re-check: the SMTP server greets and says goodbye. */
export async function mailReachable(): Promise<boolean> {
  try {
    await converse(["QUIT"]);
    return true;
  } catch {
    return false;
  }
}
