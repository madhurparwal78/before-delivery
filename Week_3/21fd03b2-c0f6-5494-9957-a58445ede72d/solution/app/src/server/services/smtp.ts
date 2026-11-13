import { randomBytes } from "node:crypto";
import net from "node:net";
import { config } from "../config";

interface Message {
  to: string;
  subject: string;
  body: string;
}

const CONNECT_MS = 3000;
const TOTAL_MS = 8000;

function address(from: string): string {
  const open = from.indexOf("<");
  return open >= 0 ? from.slice(open + 1, from.indexOf(">")) : from.trim();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function compose(message: Message): string {
  const domain = address(config.smtp.from).split("@")[1] ?? "localhost";
  const body = Buffer.from(message.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** A plain SMTP conversation: read replies by status line, send one message, quit. Rejects on any failure. */
function converse(socket: net.Socket, script: (say: (line: string, expect: number) => Promise<void>) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let waiting: { code: number; done: () => void; fail: (error: Error) => void } | null = null;
    let greeted: (() => void) | null = null;
    const check = (): void => {
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        if (/^\d{3}-/.test(line)) {
          buffer = buffer.slice(end + 2);
          continue;
        }
        buffer = buffer.slice(end + 2);
        const code = Number(line.slice(0, 3));
        if (greeted) {
          const done = greeted;
          greeted = null;
          if (code === 220) done();
          else reject(new Error(`smtp greeting ${code}`));
        } else if (waiting) {
          const current = waiting;
          waiting = null;
          if (code === current.code) current.done();
          else current.fail(new Error(`smtp expected ${current.code} got ${code}`));
        }
      }
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      check();
    });
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("smtp connection closed")));
    const say = (line: string, code: number): Promise<void> =>
      new Promise((done, fail) => {
        waiting = { code, done, fail };
        socket.write(`${line}\r\n`);
        check();
      });
    new Promise<void>((ready) => {
      greeted = ready;
    })
      .then(() => script(say))
      .then(resolve, reject);
  });
}

function connect(): net.Socket {
  const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(CONNECT_MS, () => socket.destroy(new Error("smtp timeout")));
  socket.once("connect", () => socket.setTimeout(TOTAL_MS, () => socket.destroy(new Error("smtp timeout"))));
  return socket;
}

export async function sendMessage(message: Message): Promise<void> {
  const socket = connect();
  try {
    await converse(socket, async (say) => {
      await say("EHLO rampwright", 250);
      await say(`MAIL FROM:<${address(config.smtp.from)}>`, 250);
      await say(`RCPT TO:<${message.to}>`, 250);
      await say("DATA", 354);
      const stuffed = compose(message).replace(/^\./gm, "..");
      await say(`${stuffed}\r\n.`, 250);
      await say("QUIT", 221).catch(() => undefined);
    });
  } finally {
    socket.destroy();
  }
}

/** Reachability probe: a greeting from the SMTP server means mail can go out. */
export async function probeMail(): Promise<void> {
  const socket = connect();
  try {
    await converse(socket, async (say) => {
      await say("QUIT", 221);
    });
  } finally {
    socket.destroy();
  }
}
