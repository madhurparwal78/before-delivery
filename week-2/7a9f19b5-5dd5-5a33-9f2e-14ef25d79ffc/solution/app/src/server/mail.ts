// Outgoing mail over plain SMTP to Mailpit. Every message is sent from MAIL_FROM, in plain text and HTML.
import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { dollars, MONEY_LABELS, type Totals } from "../shared/money.js";
import { config, PROVIDER_TIMEOUT_MS } from "./config.js";
import { errorCode } from "./errors.js";

interface Attachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Attachment[];
}

const fromAddress = /<([^>]+)>/.exec(config.smtp.from)?.[1] ?? config.smtp.from.trim();

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function base64Lines(data: Buffer): string {
  return (data.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function mime(message: Message): string {
  const alternative = `alt-${randomBytes(12).toString("hex")}`;
  const mixed = `mix-${randomBytes(12).toString("hex")}`;
  const body = [
    `--${alternative}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(message.text)),
    `--${alternative}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(message.html)),
    `--${alternative}--`,
  ].join("\r\n");
  const headers = [
    `From: ${encodeHeader(config.smtp.from)}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@${fromAddress.split("@")[1] ?? "lightfall"}>`,
    "MIME-Version: 1.0",
  ];
  if (!message.attachments?.length) {
    return [...headers, `Content-Type: multipart/alternative; boundary="${alternative}"`, "", body].join("\r\n");
  }
  const parts = message.attachments.map((file) =>
    [
      `--${mixed}`,
      `Content-Type: ${file.contentType}; name="${file.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${file.filename}"`,
      "",
      base64Lines(file.data),
    ].join("\r\n"),
  );
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    body,
    ...parts,
    `--${mixed}--`,
  ].join("\r\n");
}

/** Minimal SMTP conversation: one message, no auth, no TLS (Mailpit). */
export async function sendMail(message: Message): Promise<void> {
  const socket: Socket = connect({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(PROVIDER_TIMEOUT_MS);
  let buffer = "";
  const waiters: ((line: string) => void)[] = [];
  const failures: ((error: Error) => void)[] = [];
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      // A reply is complete on its last line: three digits then a space.
      if (/^\d{3} /.test(line)) waiters.shift()?.(line);
    }
  });
  const fail = (error: Error) => failures.splice(0).forEach((reject) => reject(error));
  socket.on("error", () => fail(new Error("SMTP unreachable")));
  socket.on("timeout", () => {
    fail(new Error("SMTP timed out"));
    socket.destroy();
  });
  const reply = (expected: string) =>
    new Promise<void>((resolve, reject) => {
      failures.push(reject);
      waiters.push((line) => (line.startsWith(expected) ? resolve() : reject(new Error(`SMTP said ${line.slice(0, 3)}`))));
    });
  const say = async (command: string, expected: string) => {
    const answered = reply(expected);
    socket.write(`${command}\r\n`);
    await answered;
  };
  try {
    await reply("220");
    await say("EHLO lightfall", "250");
    await say(`MAIL FROM:<${fromAddress}>`, "250");
    await say(`RCPT TO:<${message.to}>`, "250");
    await say("DATA", "354");
    const data = mime(message).replace(/^\./gm, "..");
    await say(`${data}\r\n.`, "250");
    await say("QUIT", "221");
  } finally {
    socket.destroy();
  }
}

/** Sends without holding up the request; a failure is logged by its code only. */
export function sendInBackground(message: Message): void {
  sendMail(message).catch((error: unknown) => {
    console.error("mail not sent:", errorCode(error));
  });
}

// ---- Templates -------------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function layout(title: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4efe6;color:#141821;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px">
<table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid #c9c2b4;background:#fbf8f2">
<tr><td style="padding:24px 28px;border-bottom:1px solid #c9c2b4;font-family:Georgia,serif;font-size:22px">Lightfall</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-weight:400;font-size:26px">${escapeHtml(title)}</h1>
${inner}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #c9c2b4;font-size:12px;color:#5a5f6b">Southerly Light Works · Ōtautahi Christchurch</td></tr>
</table></td></tr></table></body></html>`;
}

const paragraph = (text: string) => `<p style="margin:0 0 14px;line-height:1.5">${escapeHtml(text)}</p>`;
const mono = "font-family:Menlo,Consolas,monospace";

interface MoneyLine {
  label: string;
  cents: number | null;
}

/** A table of `<code> x <qty>` lines with their totals and the three money labels, in text and HTML. */
function linesBlock(lines: MoneyLine[], totals: Totals | null): { text: string; html: string } {
  const rows: MoneyLine[] = [
    ...lines,
    ...(totals
      ? [
          { label: MONEY_LABELS.subtotal, cents: totals.subtotal_cents },
          { label: MONEY_LABELS.gst, cents: totals.gst_cents },
          { label: MONEY_LABELS.total, cents: totals.total_cents },
        ]
      : []),
  ];
  const text = rows.map((row) => (row.cents === null ? row.label : `${row.label}  ${dollars(row.cents)}`)).join("\n");
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #c9c2b4;margin:8px 0 18px">${rows
    .map(
      (row) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e3ddd1;${mono};font-size:13px">${escapeHtml(row.label)}</td>` +
        `<td align="right" style="padding:8px 0;border-bottom:1px solid #e3ddd1;${mono};font-size:13px">${row.cents === null ? "" : dollars(row.cents)}</td></tr>`,
    )
    .join("")}</table>`;
  return { text, html };
}

export function orderConfirmationMail(input: {
  to: string;
  orderKey: string;
  onAccount: boolean;
  purchaseOrder: string | null;
  lines: MoneyLine[];
  totals: Totals;
}): Message {
  const intro = input.onAccount
    ? `Order ${input.orderKey} is on your monthly account.`
    : `Order ${input.orderKey} is confirmed and your card has been authorised.`;
  const block = linesBlock(input.lines, input.totals);
  const po = input.purchaseOrder ? `Purchase order: ${input.purchaseOrder}` : null;
  return {
    to: input.to,
    subject: `Your Lightfall order ${input.orderKey}`,
    text: [intro, ...(po ? [po] : []), "", block.text, "", "Southerly Light Works · Ōtautahi Christchurch"].join("\n"),
    html: layout(`Order ${input.orderKey}`, `${paragraph(intro)}${po ? paragraph(po) : ""}${block.html}`),
  };
}

export function tradeDecisionMail(input: { to: string; name: string; approved: boolean; reason: string | null }): Message {
  if (input.approved) {
    const body = `Kia ora ${input.name}, your Lightfall trade account is approved. Sign in again to see trade prices, build projects and order on monthly account.`;
    return {
      to: input.to,
      subject: "Your Lightfall trade account is approved",
      text: `${body}\n\nSoutherly Light Works team`,
      html: layout("Your trade account is approved", paragraph(body)),
    };
  }
  const body = `Kia ora ${input.name}, we have not approved your Lightfall trade application.`;
  return {
    to: input.to,
    subject: "About your Lightfall trade application",
    text: `${body}\n\nReason: ${input.reason}\n\nYou can still shop at retail prices.\n\nSoutherly Light Works team`,
    html: layout(
      "About your trade application",
      `${paragraph(body)}${paragraph(`Reason: ${input.reason}`)}${paragraph("You can still shop at retail prices.")}`,
    ),
  };
}

export function newsletterConfirmMail(input: { to: string; occupation: string; link: string }): Message {
  const body = `Please confirm your Lightfall newsletter subscription. You told us your occupation is ${input.occupation}.`;
  return {
    to: input.to,
    subject: "Confirm your Lightfall newsletter",
    text: `${body}\n\nConfirm here: ${input.link}\n\nIf you did not ask for this, ignore this email.`,
    html: layout(
      "Confirm your newsletter",
      `${paragraph(body)}<p style="margin:0 0 14px"><a href="${escapeHtml(input.link)}" style="color:#8a4b00">Confirm my subscription</a></p>` +
        `<p style="margin:0 0 14px;font-size:12px;${mono};word-break:break-all">${escapeHtml(input.link)}</p>`,
    ),
  };
}

export function quoteShareMail(input: {
  to: string;
  senderName: string;
  projectName: string;
  message: string | null;
  lines: MoneyLine[];
  totals: Totals | null;
  attachment: Attachment;
}): Message {
  const intro = `${input.senderName} shared a quote for ${input.projectName}. The PDF is attached.`;
  const block = linesBlock(input.lines, input.totals);
  return {
    to: input.to,
    subject: `${input.senderName} shared a Lightfall quote: ${input.projectName}`,
    text: [intro, ...(input.message ? ["", input.message] : []), "", block.text].join("\n"),
    html: layout(
      input.projectName,
      `${paragraph(intro)}${input.message ? paragraph(input.message) : ""}${block.html}`,
    ),
    attachments: [input.attachment],
  };
}

export async function healthy(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    const finish = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("data", (chunk: Buffer) => finish(chunk.toString().startsWith("220")));
    socket.once("error", () => finish(false));
  });
}
