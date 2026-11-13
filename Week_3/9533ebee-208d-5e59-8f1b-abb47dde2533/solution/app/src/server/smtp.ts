import net from "node:net";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

// A minimal SMTP client for the notice sender: one message per connection, plain text, no authentication.

interface Mail {
  to: string;
  subject: string;
  text: string;
}

function address(line: string): string {
  const match = /<([^>]+)>/.exec(line);
  return (match?.[1] ?? line).trim();
}

export function sendMail(mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setEncoding("utf8");
    socket.setTimeout(8000, () => socket.destroy(new Error("SMTP timed out")));
    const from = address(config.mailFrom);
    const body = mail.text
      .replace(/\r?\n/g, "\r\n")
      .split("\r\n")
      .map((line) => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    const message = [
      `From: ${config.mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${mail.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@${from.split("@")[1] ?? "localhost"}>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      ".",
    ].join("\r\n");
    const steps: [string | null, string][] = [
      [null, "220"],
      [`EHLO quillmoor`, "250"],
      [`MAIL FROM:<${from}>`, "250"],
      [`RCPT TO:<${mail.to}>`, "25"],
      ["DATA", "354"],
      [message, "250"],
      ["QUIT", "221"],
    ];
    let buffer = "";
    let step = 0;
    let accepted = false;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // A reply is complete once its last line has a space after the code (multi-line replies use "250-").
      const lines = buffer.split("\r\n").filter((line) => line.length > 0);
      const last = lines[lines.length - 1];
      if (!buffer.endsWith("\r\n") || last === undefined || last[3] === "-") return;
      buffer = "";
      const expected = steps[step]?.[1] ?? "";
      if (!last.startsWith(expected)) {
        socket.destroy(new Error(`SMTP refused: ${last}`));
        return;
      }
      if (steps[step]?.[0] === message) {
        // The server has taken the message; it counts as sent whatever happens to QUIT.
        accepted = true;
        resolve();
      }
      step += 1;
      const next = steps[step];
      if (next === undefined) {
        socket.end();
        return;
      }
      socket.write(`${next[0]}\r\n`);
    });
    socket.on("error", (error) => {
      if (!accepted) reject(error);
    });
    socket.on("close", () => {
      if (!accepted) reject(new Error("SMTP connection closed early"));
    });
  });
}
