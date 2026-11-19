import net from "node:net";
import { randomUUID } from "node:crypto";
import { settings } from "./config";

interface Mail {
  to: { name: string; email: string };
  subject: string;
  lines: string[];
}

const encodeWord = (text: string): string => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`);
const addressOf = (from: string): string => (from.includes("<") ? from.slice(from.indexOf("<") + 1, from.indexOf(">")) : from.trim());

function conversation(socket: net.Socket): (command: string | null) => Promise<string> {
  let buffer = "";
  const waiting: ((reply: string) => void)[] = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const lines = buffer.split("\r\n");
      const last = lines.findIndex((line) => /^\d{3} /.test(line));
      if (last < 0) return;
      const reply = lines.slice(0, last + 1).join("\r\n");
      buffer = lines.slice(last + 1).join("\r\n");
      waiting.shift()?.(reply);
    }
  });
  return (command) =>
    new Promise((resolve, reject) => {
      waiting.push((reply) => (/^[45]/.test(reply) ? reject(new Error(reply)) : resolve(reply)));
      socket.once("error", reject);
      if (command !== null) socket.write(`${command}\r\n`);
    });
}

/** Hands one plain-text message to the mail server over SMTP. */
export async function sendMail(mail: Mail): Promise<void> {
  const socket = net.connect({ host: settings.smtp.host, port: settings.smtp.port });
  socket.setTimeout(10000, () => socket.destroy(new Error("SMTP timed out")));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const say = conversation(socket);
  try {
    await say(null);
    await say("EHLO slackwater");
    await say(`MAIL FROM:<${addressOf(settings.smtp.from)}>`);
    await say(`RCPT TO:<${mail.to.email}>`);
    await say("DATA");
    const body = Buffer.from(mail.lines.join("\r\n"), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
    const message = [
      `From: ${settings.smtp.from}`,
      `To: ${encodeWord(mail.to.name)} <${mail.to.email}>`,
      `Subject: ${encodeWord(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@slackwater>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
    ].join("\r\n");
    await say(`${message}\r\n.`);
    await say("QUIT");
  } finally {
    socket.destroy();
  }
}
