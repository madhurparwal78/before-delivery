// Outgoing mail over SMTP to SMTP_HOST:SMTP_PORT (brief: Services › Mailpit). Each message goes only
// to the car's owner, names only that owner and their car, and links through APP_PUBLIC_URL.
import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { formatMoment, formatSlot, formatTimestampDay } from "../shared/zurich.js";
import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

export interface Message {
  to: { name: string; email: string };
  subject: string;
  text: string;
}

function encodeWord(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function address(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match?.[1] ?? from).trim();
}

function render(message: Message): string {
  const body = Buffer.from(message.text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  const domain = address(config.mail.from).split("@")[1] ?? "localhost";
  return [
    `From: ${config.mail.from}`,
    `To: ${encodeWord(message.to.name)} <${message.to.email}>`,
    `Subject: ${encodeWord(message.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** A minimal SMTP conversation; resolves only once the server has accepted the message. */
export function send(message: Message, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(timeoutMs);
    let buffer = "";
    const steps: { expect: string; send: string | null }[] = [
      { expect: "220", send: `EHLO lacquer\r\n` },
      { expect: "250", send: `MAIL FROM:<${address(config.mail.from)}>\r\n` },
      { expect: "250", send: `RCPT TO:<${message.to.email}>\r\n` },
      { expect: "250", send: "DATA\r\n" },
      { expect: "354", send: `${render(message)}\r\n.\r\n` },
      { expect: "250", send: "QUIT\r\n" },
    ];
    let step = 0;
    let accepted = false;
    const fail = (why: string): void => {
      socket.destroy();
      reject(new ProviderDown(why));
    };
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      // A reply is complete when its last line has a space after the code ("250 OK").
      while (true) {
        const lines = buffer.split("\r\n");
        const doneIndex = lines.findIndex((line) => /^\d{3} /.test(line));
        if (doneIndex < 0) return;
        const reply = lines[doneIndex] ?? "";
        buffer = lines.slice(doneIndex + 1).join("\r\n");
        const current = steps[step];
        if (!current) return;
        if (!reply.startsWith(current.expect)) {
          fail(`SMTP refused: ${reply}`);
          return;
        }
        if (step === 5) accepted = true;
        step += 1;
        if (current.send) socket.write(current.send);
      }
    });
    socket.on("timeout", () => fail("SMTP timed out"));
    socket.on("error", (error: Error) => fail(`SMTP unreachable: ${error.message}`));
    socket.on("close", () => {
      if (accepted) resolve();
      else reject(new ProviderDown("SMTP closed before accepting"));
    });
    socket.on("end", () => socket.end());
  });
}

/** Sends now, trying a second connection once if the first is cut off; throws ProviderDown if both fail. */
export async function sendNow(message: Message): Promise<void> {
  try {
    await send(message);
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    await send(message);
  }
}

/** True when an SMTP connection opens and greets within the probe timeout. */
export function smtpAnswers(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: config.mail.host, port: config.mail.port });
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("data", (chunk: Buffer) => {
      const ok = chunk.toString("utf8").startsWith("220");
      socket.end("QUIT\r\n");
      setTimeout(() => finish(ok), 50);
    });
    socket.once("error", () => finish(false));
  });
}

const link = (path: string): string => `${config.publicUrl}${path}`;

interface Owner {
  name: string;
  email: string;
}

export function estimateSentEmail(o: { owner: Owner; carName: string; jobId: string; jobNumber: string; title: string; total: string; expiresAt: string }): Message {
  return {
    to: o.owner,
    subject: `Estimate ${o.jobNumber} for your ${o.carName} is ready`,
    text: [
      `Dear ${o.owner.name},`,
      "",
      `Estimate ${o.jobNumber} for your ${o.carName} is ready for your answer.`,
      "",
      `Job: ${o.title}`,
      `Total: CHF ${o.total}`,
      `Approve by: ${formatTimestampDay(o.expiresAt)}`,
      "",
      `Review and approve or decline it here: ${link(`/portal/jobs/${o.jobId}`)}`,
      "",
      "Marrow & Lark Motor House",
    ].join("\n"),
  };
}

export function releaseBookedEmail(o: { owner: Owner; carName: string; releaseId: string; slot: string; bayCode: string }): Message {
  const label = formatSlot(o.slot);
  return {
    to: o.owner,
    subject: `Release booked: ${o.carName}, ${label}`,
    text: [
      `Dear ${o.owner.name},`,
      "",
      `The release of your ${o.carName} is booked for ${label}.`,
      `Your car is in bay ${o.bayCode}.`,
      "",
      `Release details: ${link(`/portal/releases/${o.releaseId}`)}`,
      "",
      "Marrow & Lark Motor House",
    ].join("\n"),
  };
}

export function invoiceIssuedEmail(o: { owner: Owner; carName: string; invoiceId: string; invoiceNumber: string; total: string }): Message {
  return {
    to: o.owner,
    subject: `Invoice ${o.invoiceNumber} for your ${o.carName}`,
    text: [
      `Dear ${o.owner.name},`,
      "",
      `Invoice ${o.invoiceNumber} for your ${o.carName} has been issued.`,
      `Total: CHF ${o.total}`,
      "",
      `View the invoice: ${link(`/portal/invoices/${o.invoiceId}`)}`,
      "",
      "Marrow & Lark Motor House",
    ].join("\n"),
  };
}

export function releasedEmail(o: { owner: Owner; carName: string; releasedAt: string; bayCode: string }): Message {
  return {
    to: o.owner,
    subject: `Your ${o.carName} has been released`,
    text: [
      `Dear ${o.owner.name},`,
      "",
      `Your ${o.carName} was released from bay ${o.bayCode} on ${formatMoment(o.releasedAt)}.`,
      "",
      "Thank you for trusting Marrow & Lark Motor House.",
    ].join("\n"),
  };
}
