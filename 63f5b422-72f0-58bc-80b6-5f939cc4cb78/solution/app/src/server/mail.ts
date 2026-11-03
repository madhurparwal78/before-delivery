import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { config } from "./config.js";

interface Mail {
  to: string;
  subject: string;
  text: string;
}

function address(value: string): string {
  const at = value.indexOf("<");
  return at >= 0 ? value.slice(at + 1, value.indexOf(">")) : value.trim();
}

function header(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function fromHeader(value: string): string {
  const at = value.indexOf("<");
  if (at < 0) return value;
  return `${header(value.slice(0, at).trim())} <${address(value)}>`;
}

/** Wrap long lines (SMTP allows 998 octets) and dot-stuff for DATA. */
function body(text: string): string {
  const lines: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    let rest = line;
    while (rest.length > 900) {
      lines.push(rest.slice(0, 900));
      rest = rest.slice(900);
    }
    lines.push(rest);
  }
  return lines.map((l) => (l.startsWith(".") ? `.${l}` : l)).join("\r\n");
}

/** Send one plain-text mail; resolves only when the SMTP server has accepted it. */
export function sendMail(mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP timed out")));
    const from = address(config.mailFrom);
    const message = [
      `From: ${fromHeader(config.mailFrom)}`,
      `To: <${mail.to}>`,
      `Subject: ${header(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomBytes(12).toString("hex")}@${from.split("@")[1] ?? "plinth.test"}>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body(mail.text),
    ].join("\r\n");
    const steps: [string, number][] = [
      ["", 220],
      ["EHLO plinth.local", 250],
      [`MAIL FROM:<${from}>`, 250],
      [`RCPT TO:<${mail.to}>`, 250],
      ["DATA", 354],
      [`${message}\r\n.`, 250],
      ["QUIT", 221],
    ];
    let buffer = "";
    let step = 0;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const lines = buffer.split("\r\n");
        const done = lines.findIndex((l) => /^\d{3} /.test(l));
        if (done < 0) return;
        const code = Number(lines[done].slice(0, 3));
        buffer = lines.slice(done + 1).join("\r\n");
        if (code !== steps[step][1]) {
          socket.destroy();
          reject(new Error(`SMTP refused: ${lines[done]}`));
          return;
        }
        if (step === 5) resolve();
        step += 1;
        if (step >= steps.length) {
          socket.end();
          return;
        }
        socket.write(`${steps[step][0]}\r\n`);
      }
    });
    socket.on("error", reject);
    socket.on("close", () => step < 6 && reject(new Error("SMTP connection closed")));
  });
}
