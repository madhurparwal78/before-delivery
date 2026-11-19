/** Sends plain-text mail through the SMTP service (mailpit in development). */
import net from "node:net";
import { config } from "./config.js";

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from.trim();
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const socket = net.connect(config.smtp.port, config.smtp.host);
  socket.setTimeout(5000);
  let buffer = "";
  const waiters: Array<(line: string) => void> = [];
  const failure = new Promise<never>((_, reject) => {
    socket.on("error", reject);
    socket.on("timeout", () => reject(new Error("smtp timeout")));
    socket.on("close", () => reject(new Error("smtp closed")));
  });
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const end = buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line)) waiters.shift()?.(line);
    }
  });
  const reply = (expect: string) =>
    Promise.race([
      new Promise<void>((resolve, reject) => {
        waiters.push((line) => (line.startsWith(expect) ? resolve() : reject(new Error(line))));
      }),
      failure,
    ]);
  const command = async (line: string, expect: string) => {
    const pending = reply(expect);
    socket.write(`${line}\r\n`);
    await pending;
  };
  try {
    await reply("220");
    await command("EHLO everyweek", "250");
    await command(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, "250");
    await command(`RCPT TO:<${to}>`, "250");
    await command("DATA", "354");
    const body = text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    const message = [
      `From: ${config.mailFrom}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      ".",
    ].join("\r\n");
    await command(message, "250");
    socket.write("QUIT\r\n");
  } finally {
    socket.destroy();
    failure.catch(() => undefined);
  }
}
