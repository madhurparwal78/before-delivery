import net from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config";

const SMTP_TIMEOUT_MS = 5000;

function envelopeAddress(from: string): string {
  const open = from.indexOf("<");
  return open === -1 ? from.trim() : from.slice(open + 1, from.indexOf(">"));
}

/** Sends one plain-text message to the SMTP server; rejects when it cannot be reached or refuses. */
export function sendMail(recipient: string, subject: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(SMTP_TIMEOUT_MS);
    const message = [
      `From: ${config.mailFrom}`,
      `To: ${recipient}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@strikeproof>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      ...text.split("\n"),
    ]
      .map((line) => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    const script: { send: string; expect: number }[] = [
      { send: `EHLO strikeproof`, expect: 250 },
      { send: `MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, expect: 250 },
      { send: `RCPT TO:<${recipient}>`, expect: 250 },
      { send: "DATA", expect: 354 },
      { send: `${message}\r\n.`, expect: 250 },
      { send: "QUIT", expect: 221 },
    ];
    let step = -1;
    let buffer = "";
    const finish = (error: Error | null): void => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.on("error", finish);
    socket.on("timeout", () => finish(new Error("SMTP timeout")));
    socket.on("close", () => {
      if (step < script.length) finish(new Error("SMTP connection closed early"));
    });
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const wanted = step === -1 ? 220 : script[step]!.expect;
        if (code !== wanted) return finish(new Error(`SMTP ${line}`));
        step += 1;
        if (step === script.length) return finish(null);
        socket.write(`${script[step]!.send}\r\n`);
      }
    });
  });
}
