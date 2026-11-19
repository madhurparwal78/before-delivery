import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config";
import { wallClock } from "./clock";

const SMTP_TIMEOUT_MS = 8000;

class MailUnavailable extends Error {}

function address(from: string): string {
  const open = from.indexOf("<");
  return open >= 0 ? from.slice(open + 1, from.indexOf(">")) : from.trim();
}

function encodeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function composeMessage(to: string, subject: string, body: string): string {
  const encoded = (Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
  const headers = [
    `From: ${config.smtp.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${wallClock().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${address(config.smtp.from).split("@")[1] ?? "longseat.test"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${encoded}\r\n`;
}

/** Deliver one plain-text email over SMTP; resolves only when the server accepts the message. */
export function sendMail(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(SMTP_TIMEOUT_MS);
    const script: { send: string; expect: number }[] = [
      { send: "", expect: 220 },
      { send: "EHLO longseat", expect: 250 },
      { send: `MAIL FROM:<${address(config.smtp.from)}>`, expect: 250 },
      { send: `RCPT TO:<${to}>`, expect: 250 },
      { send: "DATA", expect: 354 },
      { send: `${composeMessage(to, subject, body).replace(/^\./gm, "..")}.`, expect: 250 },
    ];
    let step = 0;
    let buffer = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.on("timeout", () => finish(new MailUnavailable("mail server timed out")));
    socket.on("error", () => finish(new MailUnavailable("mail server is unreachable")));
    socket.on("close", () => finish(new MailUnavailable("mail server closed the connection")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      const last = lines[lines.length - 2];
      if (last === undefined || !/^\d{3} /.test(last)) return;
      buffer = "";
      const current = script[step];
      if (!current || Number(last.slice(0, 3)) !== current.expect) {
        finish(new MailUnavailable(`mail server answered ${last.slice(0, 3)}`));
        return;
      }
      step += 1;
      const next = script[step];
      if (!next) {
        socket.write("QUIT\r\n");
        finish();
        return;
      }
      socket.write(`${next.send}\r\n`);
    });
  });
}

export async function mailReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.mailpitUrl}/livez`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}
