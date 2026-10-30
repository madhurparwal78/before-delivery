import { randomUUID } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";

export interface Message {
  to: string;
  subject: string;
  body: string;
}

const STEP_TIMEOUT_MS = 6000;

function fromAddress(): string {
  const value = config.smtp.from;
  const open = value.indexOf("<");
  return open >= 0 ? value.slice(open + 1, value.indexOf(">", open)).trim() : value.trim();
}

function headerText(raw: string): string {
  const value = raw.replace(/[\r\n\t]+/g, " ");
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function fromHeader(): string {
  const value = config.smtp.from;
  const open = value.indexOf("<");
  if (open <= 0) return value.trim();
  const display = value.slice(0, open).trim().replace(/^"|"$/g, "");
  return `${headerText(display)} <${fromAddress()}>`;
}

function render(message: Message): string {
  const domain = fromAddress().split("@")[1] ?? "localhost";
  const body = Buffer.from(message.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${fromHeader()}`,
    `To: <${message.to}>`,
    `Subject: ${headerText(message.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Delivers one message over SMTP; resolves only once the server accepted it, rejects on any failure. */
export function deliver(message: Message): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    let buffer = "";
    let settled = false;
    const steps: Array<{ send?: string; expect: number }> = [
      { expect: 220 },
      { send: `EHLO relay-bench`, expect: 250 },
      { send: `MAIL FROM:<${fromAddress()}>`, expect: 250 },
      { send: `RCPT TO:<${message.to}>`, expect: 250 },
      { send: "DATA", expect: 354 },
      { send: `${render(message).replace(/^\./gm, "..")}\r\n.`, expect: 250 },
      { send: "QUIT", expect: 221 },
    ];
    let index = 0;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(STEP_TIMEOUT_MS, () => finish(new Error("smtp timeout")));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(index >= steps.length - 1 ? undefined : new Error("smtp closed early")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const lines = buffer.split("\r\n");
        const done = lines.findIndex((line) => /^\d{3} /.test(line));
        if (done < 0) return;
        const code = Number(lines[done]!.slice(0, 3));
        buffer = lines.slice(done + 1).join("\r\n");
        const step = steps[index]!;
        if (code !== step.expect) {
          if (index === steps.length - 1) return finish();
          return finish(new Error(`smtp answered ${code}`));
        }
        index += 1;
        if (index === steps.length) return finish();
        socket.write(`${steps[index]!.send}\r\n`);
      }
    });
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utcStamp(moment: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${moment.getUTCDate()} ${MONTHS[moment.getUTCMonth()]} ${moment.getUTCFullYear()}, ${pad(moment.getUTCHours())}:${pad(moment.getUTCMinutes())} UTC`;
}

function signInUrl(token: string): string {
  return `${config.publicUrl}/auth/verify?token=${token}`;
}

function minutes(seconds: number): string {
  const value = Math.max(1, Math.round(seconds / 60));
  return value === 1 ? "1 minute" : `${value} minutes`;
}

export function signInMessage(to: string, token: string): Message {
  return {
    to,
    subject: "Your Relay Bench sign-in link",
    body: [
      "Here is your Relay Bench sign-in link:",
      "",
      signInUrl(token),
      "",
      `Open it and press "Finish signing in". The link works once and expires in ${minutes(config.magicLinkTtlSeconds)}.`,
      "",
      "If you didn't ask for it, you can ignore this email.",
      "",
    ].join("\n"),
  };
}

export function inviteMessage(to: string, mentorName: string, projectTitle: string, token: string): Message {
  return {
    to,
    subject: `${mentorName} invited you to ${projectTitle}`,
    body: [
      `${mentorName} invited you to ${projectTitle} on Relay Bench.`,
      "",
      "Follow this link to open the project:",
      "",
      signInUrl(token),
      "",
      `The link works once and expires in ${minutes(config.magicLinkTtlSeconds)}. You can always request a new one from the sign-in page.`,
      "",
    ].join("\n"),
  };
}

export function reviewerMessage(to: string, checkpointName: string, url: string, expiresAt: Date): Message {
  return {
    to,
    subject: `A Relay Bench checkpoint to review: ${checkpointName}`,
    body: [
      `You have been sent a read-only copy of the checkpoint "${checkpointName}".`,
      "",
      url,
      "",
      `The link expires ${utcStamp(expiresAt)}. No sign-in is needed.`,
      "",
    ].join("\n"),
  };
}
