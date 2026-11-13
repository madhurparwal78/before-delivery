import { config } from '../config.js';
import { formatLisbonDate } from '../../shared/lisbon.js';
import { formatPrice, type Currency } from '../../shared/money.js';
import { renderReceiptPdf } from '../media/pdf.js';

export interface ReceiptFacts {
  recipientName: string;
  recipientEmail: string;
  receiptNumber: string;
  description: string;
  amountMinor: number;
  currency: Currency;
  settledAtMs: number;
  cardLast4: string;
}

/** The only facts a receipt may carry, in one place for the email and the PDF alike. */
export function receiptLines(facts: ReceiptFacts, extraLines: string[] = []): string[] {
  return [
    facts.recipientName,
    '',
    `Receipt ${facts.receiptNumber}`,
    facts.description,
    `${formatPrice(facts.amountMinor, facts.currency)} ${facts.currency}`,
    formatLisbonDate(facts.settledAtMs),
    `Card ending ${facts.cardLast4}`,
    ...extraLines,
    '',
    `${config.publicUrl}/account`,
  ];
}

export function receiptObjectKey(receiptNumber: string): string {
  return `receipts/${receiptNumber}.pdf`;
}

export function renderReceipt(facts: ReceiptFacts, extraLines: string[] = []): Buffer {
  return renderReceiptPdf('Halden Reading Room', receiptLines(facts, extraLines));
}
