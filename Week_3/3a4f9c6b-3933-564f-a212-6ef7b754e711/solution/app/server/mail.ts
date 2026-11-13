// Mailpit over plain SMTP: one plain-text message per recipient, from Keelson <keelson@tideline.test>.
import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";

const FROM_ADDRESS = "keelson@tideline.test";
const TIMEOUT_MS = 5_000;

function connect() {
  return new Promise<{ expect: (code: number) => Promise<void>; say: (line: string, code: number) => Promise<void>; close: () => void }>((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timed out")));
    let buffer = "";
    let waiting: { code: number; resolve: () => void; reject: (error: Error) => void } | null = null;
    const fail = (error: Error) => {
      waiting?.reject(error);
      waiting = null;
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // A reply is complete at a line of the form "250 text" (a dash after the code means more lines follow).
      const lines = buffer.split("\r\n");
      const last = lines.findIndex((line) => /^\d{3}(?: |$)/.test(line));
      if (last < 0 || !waiting) return;
      const code = Number(lines[last]?.slice(0, 3));
      buffer = lines.slice(last + 1).join("\r\n");
      const pending = waiting;
      waiting = null;
      if (code === pending.code) pending.resolve();
      else pending.reject(new Error(`SMTP answered ${lines[last]}`));
    });
    socket.on("error", (error) => {
      fail(error);
      reject(error);
    });
    socket.on("close", () => fail(new Error("SMTP connection closed")));
    const expect = (code: number) => new Promise<void>((done, refuse) => {
      waiting = { code, resolve: done, reject: refuse };
      socket.emit("data", Buffer.alloc(0));
    });
    socket.once("connect", () => resolve({
      expect,
      say: (line, code) => {
        socket.write(`${line}\r\n`);
        return expect(code);
      },
      close: () => socket.end(),
    }));
  });
}

function header(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const smtp = await connect();
  try {
    await smtp.expect(220);
    await smtp.say("EHLO keelson", 250);
    await smtp.say(`MAIL FROM:<${FROM_ADDRESS}>`, 250);
    await smtp.say(`RCPT TO:<${to}>`, 250);
    await smtp.say("DATA", 354);
    const message = [
      `From: Keelson <${FROM_ADDRESS}>`,
      `To: <${to}>`,
      `Subject: ${header(subject)}`,
      `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
      `Message-ID: <${randomUUID()}@tideline.test>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      ...text.split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line)),
    ].join("\r\n");
    await smtp.say(`${message}\r\n.`, 250);
    await smtp.say("QUIT", 221);
  } finally {
    smtp.close();
  }
}

/** Mail is reachable when the server greets a fresh connection. */
export async function mailReachable(): Promise<boolean> {
  try {
    const smtp = await connect();
    try {
      await smtp.expect(220);
      await smtp.say("QUIT", 221);
      return true;
    } finally {
      smtp.close();
    }
  } catch {
    return false;
  }
}
