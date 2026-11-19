import type { Queryable } from '../db/pool.js';

type SequenceKind = 'invoice' | 'credit_note';

interface SequenceRow {
  last_value: number;
}

/**
 * Takes the next value of a gapless per-year sequence. Called inside the
 * transaction that records the document, so a rollback leaves no gap.
 */
async function takeNext(client: Queryable, kind: SequenceKind, year: number): Promise<number> {
  const result = await client.query<SequenceRow>(
    `INSERT INTO number_sequences (kind, year, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (kind, year) DO UPDATE SET last_value = number_sequences.last_value + 1
     RETURNING last_value`,
    [kind, year],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Sequence ${kind}/${year} returned no value`);
  return row.last_value;
}

function pad6(value: number): string {
  return String(value).padStart(6, '0');
}

/** `PY-<YYYY>-<6 digits>`, keyed to the UTC year the order was paid. */
export async function nextInvoiceNumber(client: Queryable, paidAt: Date): Promise<string> {
  const year = paidAt.getUTCFullYear();
  return `PY-${year}-${pad6(await takeNext(client, 'invoice', year))}`;
}

/** `PY-CN-<YYYY>-<6 digits>`, keyed to the refund's UTC year. */
export async function nextCreditNoteNumber(client: Queryable, refundedAt: Date): Promise<string> {
  const year = refundedAt.getUTCFullYear();
  return `PY-CN-${year}-${pad6(await takeNext(client, 'credit_note', year))}`;
}
