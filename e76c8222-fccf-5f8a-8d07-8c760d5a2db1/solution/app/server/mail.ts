// A minimal SMTP client: one message per connection, delivered only when the server accepts its end.
import { Socket } from "node:net";
import { config } from "./config.js";

const SENDER_ADDRESS = "dispatch@fernhollow.test";
const SENDER = `Fernhollow Access Dispatch <${SENDER_ADDRESS}>`;
const TIMEOUT_MS = 10_000;

interface OutgoingMail {
  messageId: string;
  to: string;
  subject: string;
  body: string;
}

const header = (text: string): string =>
  /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;

function render(mail: OutgoingMail): string {
  const lines = [
    `From: ${SENDER}`,
    `To: ${mail.to}`,
    `Subject: ${header(mail.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${mail.messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    ...mail.body.split(/\r?\n/).map((line) => (line.startsWith(".") ? `.${line}` : line)),
  ];
  return `${lines.join("\r\n")}\r\n.\r\n`;
}

/** Sends one message; resolves only after the server's 250 for the end of DATA. */
export function deliver(mail: OutgoingMail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let buffer = "";
    let step = 0;
    const script: { send: string | null; expect: number }[] = [
      { send: null, expect: 220 },
      { send: "EHLO seatweaver.local", expect: 250 },
      { send: `MAIL FROM:<${SENDER_ADDRESS}>`, expect: 250 },
      { send: `RCPT TO:<${mail.to}>`, expect: 250 },
      { send: "DATA", expect: 354 },
      { send: render(mail), expect: 250 },
    ];
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(TIMEOUT_MS, () => fail(new Error("smtp timeout")));
    socket.on("error", fail);
    // A connection closed before the final 250 is a failed attempt (a no-op once resolved).
    socket.on("close", () => reject(new Error("smtp connection closed")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const replies = buffer.split("\r\n");
      buffer = replies.pop() ?? "";
      for (const reply of replies) {
        if (/^\d{3}-/.test(reply)) continue;
        const code = Number.parseInt(reply.slice(0, 3), 10);
        const expected = script[step];
        if (!expected || code !== expected.expect) {
          fail(new Error(`smtp refused: ${reply}`));
          return;
        }
        step += 1;
        const next = script[step];
        if (!next) {
          socket.end("QUIT\r\n");
          resolve();
          return;
        }
        socket.write(next.send?.endsWith("\r\n.\r\n") ? next.send : `${next.send}\r\n`);
      }
    });
    socket.connect(config.smtp.port, config.smtp.host);
  });
}

export async function mailReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.mailpitUrl}/readyz`, { signal: AbortSignal.timeout(2000) });
    await response.arrayBuffer();
    return response.status < 500;
  } catch {
    return false;
  }
}
