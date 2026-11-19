import { creditNoteNumber, invoiceNumber } from '../domain.js';
import type { Tx } from './db.js';

export async function nextInvoiceNumber(tx: Tx, paidAt: Date): Promise<string> {
  const year = paidAt.getUTCFullYear();
  const row = await tx.one<{ last_invoice: string }>(
    `INSERT INTO invoice_sequences (year, last_invoice, last_credit_note) VALUES ($1, 1, 0)
     ON CONFLICT (year) DO UPDATE SET last_invoice = invoice_sequences.last_invoice + 1
     RETURNING last_invoice::text`,
    [year]
  );
  return invoiceNumber(year, Number(row?.last_invoice ?? 1));
}

export async function nextCreditNoteNumber(tx: Tx, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const row = await tx.one<{ last_credit_note: string }>(
    `INSERT INTO invoice_sequences (year, last_invoice, last_credit_note) VALUES ($1, 0, 1)
     ON CONFLICT (year) DO UPDATE SET last_credit_note = invoice_sequences.last_credit_note + 1
     RETURNING last_credit_note::text`,
    [year]
  );
  return creditNoteNumber(year, Number(row?.last_credit_note ?? 1));
}
