// A small SMTP client for Mailpit: one connection per message, plain SMTP as the service offers.
import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";

interface Mail {
  to: string;
  subject: string;
  body: string;
  workspaceId: string;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function address(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

function render(mail: Mail): string {
  const body = Buffer.from(mail.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  const fromAddress = address(config.smtp.from);
  const headers = [
    `From: ${config.smtp.from}`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${fromAddress.split("@")[1] ?? "tallyroom.test"}>`,
    `X-Tallyroom-Workspace: ${mail.workspaceId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** Resolves once the server has accepted the message (250 after DATA); rejects on any failure. */
export function sendMail(mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000);
    const steps: { send: string | null; expect: number }[] = [
      { send: null, expect: 220 },
      { send: "EHLO tallyroom\r\n", expect: 250 },
      { send: `MAIL FROM:<${address(config.smtp.from)}>\r\n`, expect: 250 },
      { send: `RCPT TO:<${mail.to}>\r\n`, expect: 250 },
      { send: "DATA\r\n", expect: 354 },
      { send: `${render(mail).replace(/^\./gm, "..")}\r\n.\r\n`, expect: 250 },
    ];
    let step = 0;
    let buffer = "";
    let done = false;
    const fail = (error: Error): void => {
      if (done) return;
      done = true;
      socket.destroy();
      reject(error);
    };
    socket.on("error", fail);
    socket.on("timeout", () => fail(new Error("SMTP timeout")));
    socket.on("close", () => fail(new Error("SMTP connection closed")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const current = steps[step];
        if (!current || code !== current.expect) {
          fail(new Error(`SMTP ${line}`));
          return;
        }
        step++;
        const next = steps[step];
        if (next?.send) socket.write(next.send);
        else if (!next) {
          done = true;
          socket.end("QUIT\r\n");
          resolve();
          return;
        }
      }
    });
  });
}
