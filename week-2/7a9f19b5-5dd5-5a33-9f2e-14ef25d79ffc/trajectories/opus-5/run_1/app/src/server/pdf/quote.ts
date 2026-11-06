/**
 * A project's quote PDF at the share's price display. A `none` share carries no
 * dollar sign, no amount and no GST line anywhere in the document.
 */

import { PAGE, PdfDocument } from "./document.js";
import { MONEY_LABELS } from "../../shared/gst.js";
import { formatMoney } from "../../shared/money.js";
import type { PriceDisplay } from "../../shared/types.js";

const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const BOTTOM_LIMIT = PAGE.margin + 60;

export interface QuoteLine {
  variant_code: string;
  product_name: string;
  finish_name: string;
  beam_deg: number;
  cct_k: number;
  quantity: number;
  unit_price_cents: number | null;
  line_total_cents: number | null;
}

export interface QuoteDocument {
  projectName: string;
  clientName: string | null;
  senderName: string;
  message: string | null;
  priceDisplay: PriceDisplay;
  lines: readonly QuoteLine[];
  totals: { subtotal_cents: number; gst_cents: number; total_cents: number } | null;
}

export function buildQuotePdf(quote: QuoteDocument): Buffer {
  const doc = new PdfDocument();
  const showPrices = quote.priceDisplay !== "none";
  let y = PAGE.height - PAGE.margin;

  const newPageIfNeeded = (needed: number): void => {
    if (y - needed >= BOTTOM_LIMIT) return;
    doc.newPage();
    y = PAGE.height - PAGE.margin;
  };

  doc.text("Lightfall quote", { x: PAGE.margin, y, family: "display", size: 14, grey: 0.45 });
  y -= 32;
  doc.text(quote.projectName, { x: PAGE.margin, y, family: "display", size: 26 });
  y -= 18;

  const meta = [`Prepared by ${quote.senderName}`];
  if (quote.clientName) meta.unshift(`Client: ${quote.clientName}`);
  doc.text(meta.join("   \u00b7   "), { x: PAGE.margin, y, family: "body", size: 10, grey: 0.4 });
  y -= 14;
  doc.rule({ x: PAGE.margin, y, width: CONTENT_WIDTH });
  y -= 22;

  if (quote.message) {
    for (const line of wrap(doc, quote.message, 10, CONTENT_WIDTH)) {
      newPageIfNeeded(14);
      doc.text(line, { x: PAGE.margin, y, family: "body", size: 10 });
      y -= 14;
    }
    y -= 10;
  }

  const columns = showPrices
    ? [
        { label: "Code", x: PAGE.margin, align: "left" as const },
        { label: "Fitting", x: PAGE.margin + 108, align: "left" as const },
        { label: "Qty", x: PAGE.margin + 352, align: "right" as const },
        { label: "Unit", x: PAGE.margin + 420, align: "right" as const },
        { label: "Line", x: PAGE.width - PAGE.margin, align: "right" as const },
      ]
    : [
        { label: "Code", x: PAGE.margin, align: "left" as const },
        { label: "Fitting", x: PAGE.margin + 108, align: "left" as const },
        { label: "Qty", x: PAGE.width - PAGE.margin, align: "right" as const },
      ];

  for (const column of columns) {
    doc.text(column.label, {
      x: column.x,
      y,
      family: "bodyStrong",
      size: 9,
      grey: 0.4,
      align: column.align,
    });
  }
  y -= 8;
  doc.rule({ x: PAGE.margin, y, width: CONTENT_WIDTH, grey: 0.6 });
  y -= 15;

  for (const line of quote.lines) {
    newPageIfNeeded(26);
    const description = `${line.product_name}, ${line.finish_name}, ${line.beam_deg}\u00b0, ${line.cct_k}K`;
    doc.text(line.variant_code, { x: PAGE.margin, y, family: "mono", size: 9 });
    doc.text(fit(doc, description, 9, 236), { x: PAGE.margin + 108, y, family: "body", size: 9 });
    if (showPrices) {
      doc.text(String(line.quantity), { x: PAGE.margin + 352, y, family: "mono", size: 9, align: "right" });
      if (line.unit_price_cents !== null) {
        doc.text(formatMoney(line.unit_price_cents), {
          x: PAGE.margin + 420,
          y,
          family: "mono",
          size: 9,
          align: "right",
        });
      }
      if (line.line_total_cents !== null) {
        doc.text(formatMoney(line.line_total_cents), {
          x: PAGE.width - PAGE.margin,
          y,
          family: "mono",
          size: 9,
          align: "right",
        });
      }
    } else {
      doc.text(String(line.quantity), { x: PAGE.width - PAGE.margin, y, family: "mono", size: 9, align: "right" });
    }
    y -= 7;
    doc.rule({ x: PAGE.margin, y, width: CONTENT_WIDTH, grey: 0.9 });
    y -= 14;
  }

  if (showPrices && quote.totals) {
    y -= 10;
    const rows: ReadonlyArray<readonly [string, number]> = [
      [MONEY_LABELS.subtotal, quote.totals.subtotal_cents],
      [MONEY_LABELS.gst, quote.totals.gst_cents],
      [MONEY_LABELS.total, quote.totals.total_cents],
    ];
    for (const [label, cents] of rows) {
      newPageIfNeeded(20);
      doc.text(label, { x: PAGE.margin + 300, y, family: "bodyStrong", size: 10 });
      doc.text(formatMoney(cents), { x: PAGE.width - PAGE.margin, y, family: "mono", size: 10, align: "right" });
      y -= 16;
    }
  }

  newPageIfNeeded(30);
  y -= 10;
  doc.text("Southerly Light Works \u00b7 \u014ctautahi Christchurch", {
    x: PAGE.margin,
    y,
    family: "body",
    size: 9,
    grey: 0.45,
  });

  return doc.build();
}

function wrap(doc: PdfDocument, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (doc.measure(candidate, "body", size) <= maxWidth) {
      current = candidate;
    } else {
      if (current !== "") lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

function fit(doc: PdfDocument, text: string, size: number, maxWidth: number): string {
  if (doc.measure(text, "body", size) <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && doc.measure(`${trimmed}\u2026`, "body", size) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}\u2026`;
}
