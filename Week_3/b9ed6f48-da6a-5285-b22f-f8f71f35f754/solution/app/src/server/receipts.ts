// Receipts: the email text and the PDF hold exactly the payer's name, the receipt number, the
// item, the amount with its currency, the date, the card's last four digits and the account
// link; a ticket adds its code, seats and start (brief: Services › Mailpit › Receipt contents).

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { config } from "./config.js";
import { formatPrice, type Currency } from "../shared/money.js";
import { formatLisbonDate } from "../shared/lisbon.js";

export interface ReceiptContent {
  name: string;
  receiptNumber: string;
  description: string;
  amountMinor: number;
  currency: Currency;
  /** Lisbon date of the payment, `YYYY-MM-DD`. */
  date: string;
  last4: string;
  ticket?: { code: string; seats: number; datetime: string };
}

function receiptLines(c: ReceiptContent): string[] {
  return [
    c.name,
    `Receipt ${c.receiptNumber}`,
    c.description,
    `${formatPrice(c.amountMinor, c.currency)} ${c.currency}`,
    formatLisbonDate(c.date),
    `Card ending ${c.last4}`,
    ...(c.ticket ? [`Ticket ${c.ticket.code}`, c.ticket.seats === 1 ? "1 seat" : `${c.ticket.seats} seats`, c.ticket.datetime] : []),
    `${config.publicUrl}/account`,
  ];
}

export function receiptEmail(c: ReceiptContent): string {
  return `${receiptLines(c).join("\n")}\n`;
}

/** Characters the standard PDF font cannot encode become "?". */
function encodable(font: PDFFont, text: string): string {
  return [...text]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    })
    .join("");
}

const INK = rgb(0.09, 0.09, 0.07);
const MUTED = rgb(0.4, 0.39, 0.35);
const RULE = rgb(0.75, 0.73, 0.68);

export async function receiptPdf(c: ReceiptContent): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${c.receiptNumber}`);
  doc.setProducer("Halden Reading Room");
  const page = doc.addPage([420, 595]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const left = 40;
  const right = 380;
  page.drawRectangle({ x: 24, y: 24, width: 372, height: 547, borderColor: RULE, borderWidth: 0.75 });
  const [name, number, description, amount, date, card, ...rest] = receiptLines(c);
  const link = rest.pop() ?? "";
  page.drawText(encodable(mono, number), { x: left, y: 530, size: 10, font: mono, color: MUTED });
  page.drawLine({ start: { x: left, y: 518 }, end: { x: right, y: 518 }, thickness: 0.5, color: RULE });
  page.drawText(encodable(serif, description), { x: left, y: 488, size: 17, lineHeight: 21, font: serif, color: INK, maxWidth: right - left });
  page.drawText(encodable(sans, name), { x: left, y: 418, size: 11, font: sans, color: INK });
  page.drawText(encodable(serif, amount), { x: left, y: 384, size: 30, font: serif, color: INK });
  page.drawLine({ start: { x: left, y: 366 }, end: { x: right, y: 366 }, thickness: 0.5, color: RULE });
  let y = 340;
  for (const line of [date, card, ...rest]) {
    page.drawText(encodable(sans, line), { x: left, y, size: 11, font: sans, color: INK });
    y -= 20;
  }
  page.drawLine({ start: { x: left, y: 64 }, end: { x: right, y: 64 }, thickness: 0.5, color: RULE });
  page.drawText(encodable(mono, link), { x: left, y: 46, size: 9, font: mono, color: MUTED });
  return Buffer.from(await doc.save());
}
