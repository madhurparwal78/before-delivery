/**
 * Mailpit over SMTP. Every message goes out from `MAIL_FROM` in both plain text
 * and HTML. Money in emails carries the same three labels as the cart and the
 * order, to the cent.
 */

import { loadConfig, PROVIDER_TIMEOUT_MS } from "../config.js";
import { MONEY_LABELS } from "../../shared/gst.js";
import { formatMoney } from "../../shared/money.js";
import { MAIL_SUBJECTS } from "../../shared/copy.js";
import type { Order, PriceDisplay } from "../../shared/types.js";
import { ProviderUnavailable } from "./provider.js";
import { probe, sendMail, type SmtpAttachment } from "./smtp.js";

const config = loadConfig();

const smtp = { host: config.smtp.host, port: config.smtp.port, timeoutMs: PROVIDER_TIMEOUT_MS };

interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: SmtpAttachment[];
}

async function send(message: Message): Promise<void> {
  try {
    await sendMail(smtp, { from: config.smtp.from, ...message });
  } catch (cause) {
    throw new ProviderUnavailable("mailpit", cause);
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (match) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[match] ?? match);

function htmlPage(heading: string, blocks: readonly string[]): string {
  return [
    "<!doctype html><html><body style=\"font-family:system-ui,sans-serif;color:#15171c;line-height:1.5\">",
    `<h1 style="font-size:20px">${escapeHtml(heading)}</h1>`,
    ...blocks,
    `<p style="color:#6b7280;font-size:12px">Southerly Light Works &middot; \u014ctautahi Christchurch</p>`,
    "</body></html>",
  ].join("");
}

const paragraph = (text: string): string => `<p>${escapeHtml(text)}</p>`;

function moneyRows(order: Pick<Order, "subtotal_cents" | "gst_cents" | "total_cents">): Array<[string, string]> {
  return [
    [MONEY_LABELS.subtotal, formatMoney(order.subtotal_cents)],
    [MONEY_LABELS.gst, formatMoney(order.gst_cents)],
    [MONEY_LABELS.total, formatMoney(order.total_cents)],
  ];
}

function htmlTable(rows: ReadonlyArray<readonly [string, string]>): string {
  const body = rows
    .map(
      ([left, right]) =>
        `<tr><td style="padding:4px 12px 4px 0;border-bottom:1px solid #e5e7eb">${escapeHtml(left)}</td>` +
        `<td style="padding:4px 0;text-align:right;border-bottom:1px solid #e5e7eb;font-family:monospace">${escapeHtml(
          right,
        )}</td></tr>`,
    )
    .join("");
  return `<table style="border-collapse:collapse;min-width:320px">${body}</table>`;
}

/**
 * Order confirmation, sent once per order when it is authorised or placed. Each
 * line reads `<variant_code> x <quantity>` with its line total.
 */
export async function sendOrderConfirmation(args: { to: string; order: Order }): Promise<void> {
  const { order } = args;
  const lineRows = order.lines.map(
    (line) => [`${line.variant_code} x ${line.quantity}`, formatMoney(line.line_total_cents)] as const,
  );
  const rows = [...lineRows, ...moneyRows(order)];

  const heading =
    order.payment_method === "account"
      ? `Order ${order.order_key} is on your monthly account`
      : `Order ${order.order_key} is confirmed`;

  const textLines = [
    heading,
    "",
    ...rows.map(([left, right]) => `${left}  ${right}`),
  ];
  if (order.purchase_order) textLines.push("", `Purchase order: ${order.purchase_order}`);

  const blocks = [htmlTable(rows)];
  if (order.purchase_order) blocks.push(paragraph(`Purchase order: ${order.purchase_order}`));

  await send({
    to: args.to,
    subject: MAIL_SUBJECTS.orderConfirmation(order.order_key),
    text: `${textLines.join("\n")}\n`,
    html: htmlPage(heading, blocks),
  });
}

export async function sendTradeApproved(args: { to: string; name: string }): Promise<void> {
  const heading = "Your Lightfall trade account is approved";
  const body =
    `Kia ora ${args.name}, your Lightfall trade account is approved. ` +
    "Sign in again to see trade prices and to start building projects.";
  await send({
    to: args.to,
    subject: MAIL_SUBJECTS.tradeApproved,
    text: `${heading}\n\n${body}\n`,
    html: htmlPage(heading, [paragraph(body)]),
  });
}

export async function sendTradeDeclined(args: { to: string; name: string; reason: string }): Promise<void> {
  const heading = "About your Lightfall trade application";
  const body = `Kia ora ${args.name}, we are not able to approve your Lightfall trade application.`;
  await send({
    to: args.to,
    subject: MAIL_SUBJECTS.tradeDeclined,
    text: `${heading}\n\n${body}\n\nReason: ${args.reason}\n\nYou can still shop at retail prices.\n`,
    html: htmlPage(heading, [
      paragraph(body),
      paragraph(`Reason: ${args.reason}`),
      paragraph("You can still shop at retail prices."),
    ]),
  });
}

export interface QuoteEmailLine {
  variant_code: string;
  product_name: string;
  finish_name: string;
  beam_deg: number;
  cct_k: number;
  quantity: number;
  line_total_cents: number | null;
}

/**
 * One quote message per recipient, with the PDF attached. A `none` price display
 * carries no dollar sign, no amount and no GST line anywhere in the message.
 */
export async function sendQuoteShare(args: {
  to: string;
  senderName: string;
  projectName: string;
  message: string | null;
  priceDisplay: PriceDisplay;
  lines: readonly QuoteEmailLine[];
  totals: { subtotal_cents: number; gst_cents: number; total_cents: number } | null;
  shareId: string;
  pdf: Buffer;
}): Promise<void> {
  const showPrices = args.priceDisplay !== "none";
  const rows: Array<readonly [string, string]> = args.lines.map((line) => {
    const left = `${line.variant_code} x ${line.quantity}`;
    const right = showPrices && line.line_total_cents !== null ? formatMoney(line.line_total_cents) : "";
    return [left, right] as const;
  });
  const specRows: Array<readonly [string, string]> = args.lines.map(
    (line) =>
      [`${line.variant_code}`, `${line.product_name}, ${line.finish_name}, ${line.beam_deg}\u00b0, ${line.cct_k}K`] as const,
  );

  const moneyPart = showPrices && args.totals ? moneyRows(args.totals) : [];
  const heading = `${args.senderName} shared a Lightfall quote: ${args.projectName}`;

  const textLines = [heading, ""];
  if (args.message) textLines.push(args.message, "");
  for (const [left, right] of specRows) textLines.push(`${left}  ${right}`);
  textLines.push("");
  for (const [left, right] of rows) textLines.push(right ? `${left}  ${right}` : left);
  if (moneyPart.length > 0) {
    textLines.push("");
    for (const [left, right] of moneyPart) textLines.push(`${left}  ${right}`);
  }

  const blocks: string[] = [];
  if (args.message) blocks.push(paragraph(args.message));
  blocks.push(htmlTable(specRows));
  blocks.push(htmlTable(showPrices ? [...rows, ...moneyPart] : rows));

  await send({
    to: args.to,
    subject: MAIL_SUBJECTS.quoteShare(args.senderName, args.projectName),
    text: `${textLines.join("\n")}\n`,
    html: htmlPage(heading, blocks),
    attachments: [
      { filename: `lightfall-quote-${args.shareId}.pdf`, content: args.pdf, contentType: "application/pdf" },
    ],
  });
}

export async function sendNewsletterConfirmation(args: {
  to: string;
  occupationLabel: string;
  token: string;
}): Promise<void> {
  const link = `${config.app.publicUrl}/newsletter/confirm?token=${encodeURIComponent(args.token)}`;
  const heading = "Confirm your Lightfall newsletter";
  const body = `You asked for the Lightfall newsletter as ${args.occupationLabel}. Follow the link to confirm.`;
  await send({
    to: args.to,
    subject: MAIL_SUBJECTS.newsletterConfirm,
    text: `${heading}\n\n${body}\n\n${link}\n`,
    html: htmlPage(heading, [paragraph(body), `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`]),
  });
}

/** Health probe: opens an SMTP conversation with Mailpit. */
export async function ping(timeoutMs: number): Promise<void> {
  try {
    await probe({ host: config.smtp.host, port: config.smtp.port, timeoutMs });
  } catch (cause) {
    throw new ProviderUnavailable("mailpit", cause);
  }
}
