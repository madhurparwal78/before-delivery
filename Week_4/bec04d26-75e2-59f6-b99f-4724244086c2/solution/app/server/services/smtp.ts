import { createInterface } from "node:readline";
import net from "node:net";
import { config } from "../config";

const TIMEOUT_MS = 8000;

interface Mail { to: string; subject: string; body: string }

function connect(): Promise<{ socket: net.Socket; reply: () => Promise<number>; say: (line: string) => void }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("smtp timeout")));
    socket.once("error", reject);
    socket.once("connect", () => {
      const lines = createInterface({ input: socket })[Symbol.asyncIterator]();
      const reply = async (): Promise<number> => {
        for (;;) {
          const next = await lines.next();
          if (next.done) throw new Error("smtp closed");
          if (/^\d{3} /.test(next.value)) return Number(next.value.slice(0, 3));
        }
      };
      resolve({ socket, reply, say: (line) => socket.write(`${line}\r\n`) });
    });
  });
}

const encodeHeader = (text: string): string =>
  /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;

const address = (value: string): string => (value.includes("<") ? value.slice(value.indexOf("<") + 1, value.indexOf(">")) : value.trim());

/** Delivers one plain-text message; resolves only once the server has accepted it. */
export async function sendMail(mail: Mail): Promise<void> {
  const { socket, reply, say } = await connect();
  try {
    const expect = async (code: number, what: string) => {
      const got = await reply();
      if (got !== code) throw new Error(`smtp ${what} answered ${got}`);
    };
    await expect(220, "greeting");
    say("EHLO duefield");
    await expect(250, "EHLO");
    say(`MAIL FROM:<${address(config.mailFrom)}>`);
    await expect(250, "MAIL");
    say(`RCPT TO:<${mail.to}>`);
    await expect(250, "RCPT");
    say("DATA");
    await expect(354, "DATA");
    const body = Buffer.from(mail.body.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/(.{76})/g, "$1\r\n");
    const message = [
      `From: ${config.mailFrom}`, `To: ${mail.to}`, `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64", "", body,
    ].join("\r\n");
    socket.write(`${message}\r\n.\r\n`);
    await expect(250, "message");
    say("QUIT");
  } finally {
    socket.destroy();
  }
}

/** True when the mail server greets a new connection. */
export async function smtpAnswers(): Promise<boolean> {
  try {
    const { socket, reply } = await connect();
    try {
      return (await reply()) === 220;
    } finally {
      socket.destroy();
    }
  } catch {
    return false;
  }
}
