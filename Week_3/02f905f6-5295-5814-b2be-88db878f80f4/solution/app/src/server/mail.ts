// SMTP delivery to the mail server and the four studio emails.
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { config } from "./config";

export class MailUnavailable extends Error {}

export interface Message {
  toAddress: string;
  toName: string;
  subject: string;
  text: string;
  html: string;
}

/** Header values never carry CR or LF, so a stored name or subject cannot inject a header. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeWord(value: string): string {
  const safe = headerSafe(value);
  return /^[\x20-\x7e]*$/.test(safe) ? safe : `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

function mailbox(name: string, address: string): string {
  const quoted = encodeWord(name).replace(/["\\]/g, "");
  return `"${quoted}" <${headerSafe(address)}>`;
}

function fromAddress(): string {
  const match = /<([^>]+)>/.exec(config.smtp.from);
  return headerSafe(match?.[1] ?? config.smtp.from);
}

function base64Lines(text: string): string {
  return (Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function compose(message: Message): string {
  const boundary = `shelfmark-${randomUUID()}`;
  const domain = fromAddress().split("@")[1] ?? "shelfmark.invalid";
  return [
    `From: ${headerSafe(config.smtp.from)}`,
    `To: ${mailbox(message.toName, message.toAddress)}`,
    `Subject: ${encodeWord(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Sends one message and resolves only once the mail server has accepted it (250 after DATA). */
export function send(message: Message): Promise<void> {
  const commands = [
    `EHLO shelfmark`,
    `MAIL FROM:<${fromAddress()}>`,
    `RCPT TO:<${headerSafe(message.toAddress)}>`,
    "DATA",
    `${compose(message)}\r\n.`,
    "QUIT",
  ];
  const expected = [220, 250, 250, 250, 354, 250, 221];
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    let buffer = "";
    let step = 0;
    let accepted = false;
    const fail = (reason: string) => {
      socket.destroy();
      reject(new MailUnavailable(reason));
    };
    socket.setTimeout(15_000, () => fail("mail server timed out"));
    socket.on("error", () => fail("mail server is unreachable"));
    socket.on("close", () => (accepted ? resolve() : reject(new MailUnavailable("mail server closed the connection"))));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code !== expected[step]) {
          fail(`mail server answered ${code}`);
          return;
        }
        if (step === 5) accepted = true;
        if (step === commands.length) {
          socket.end();
          return;
        }
        socket.write(`${commands[step]}\r\n`);
        step += 1;
      }
    });
  });
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Plain text and a small bisque HTML version of the same lines; the first line is the heading. */
function letter(heading: string, lines: string[]): { text: string; html: string } {
  const text = [heading, "", ...lines, "", "Brickfield Lane Clayhouse"].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F3E6D3;color:#3B2A1E;font-family:Georgia,serif">
<div style="max-width:520px;margin:0 auto;background:#F8EEDF;border-top:1px dotted #8A6F5A;padding:24px">
<h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(heading)}</h1>
${lines.map((line) => (line ? `<p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:15px">${escapeHtml(line)}</p>` : "")).join("\n")}
<p style="margin:24px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6B5444">Brickfield Lane Clayhouse</p>
</div></body></html>`;
  return { text, html };
}

interface ReceiptFacts {
  number: string;
  sides: string;
  cubic: string;
  rate: string;
  discountPercent: number;
  minimumApplied: boolean;
  minimum: string;
  fee: string;
  trackingUrl: string | null;
}

export function receipt(toAddress: string, toName: string, facts: ReceiptFacts): Message {
  const lines = [
    `Piece ${facts.number}`,
    `Rounded sides: ${facts.sides}`,
    `Cubic inches: ${facts.cubic} in³`,
    `Rate per cubic inch: $${facts.rate}`,
    `Discount: ${facts.discountPercent}%`,
    `Order minimum: $${facts.minimum} (${facts.minimumApplied ? "applied" : "not applied"})`,
    `Fee $${facts.fee}`,
  ];
  if (facts.trackingUrl) lines.push("", `Amount due $${facts.fee}`, `Track your piece: ${facts.trackingUrl}`);
  return { toAddress, toName, subject: `Intake receipt: Piece ${facts.number}`, ...letter("Your intake receipt", lines) };
}

export function readyNotice(toAddress: string, toName: string, number: string, shelf: string, trackingUrl: string | null): Message {
  const lines = [`Piece ${number}`, `Pickup shelf ${shelf}`];
  if (trackingUrl) lines.push(`Track your piece: ${trackingUrl}`);
  return {
    toAddress,
    toName,
    subject: `Ready on pickup shelf: Piece ${number}`,
    ...letter("Your piece is ready on the pickup shelf", lines),
  };
}

export function pickupReminder(toAddress: string, toName: string, number: string, shelf: string, days: number): Message {
  return {
    toAddress,
    toName,
    subject: `Still on the pickup shelf: Piece ${number}`,
    ...letter("Your piece is still on the pickup shelf", [
      `Piece ${number}`,
      `Pickup shelf ${shelf}`,
      `Days waiting: ${days}`,
    ]),
  };
}

export function newTrackingLink(toAddress: string, toName: string, number: string, trackingUrl: string): Message {
  return {
    toAddress,
    toName,
    subject: `New tracking link for Piece ${number}`,
    ...letter("A new tracking link for your piece", [
      `Piece ${number}`,
      `Track your piece: ${trackingUrl}`,
      "Earlier links for this piece no longer work.",
    ]),
  };
}
