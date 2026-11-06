import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { toInstantString } from '../../shared/zone.js';
import type { CharterQuote } from './pricing.js';
import type { Season } from './weeks.js';

export interface CharterRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly yacht_id: string;
  readonly hold_id: string | null;
  readonly week_start: string;
  readonly week_end: string;
  readonly client_name: string;
  readonly client_email: string;
  readonly currency: string;
  readonly season: Season;
  readonly deposit_date: string | null;
  readonly exchange_table_id: string | null;
  readonly rate: string;
  readonly total_eur_minor: string;
  readonly total_minor: string;
  readonly invoice_status: 'invoiced' | 'not_invoiced';
  readonly killbill_invoice_id: string | null;
  readonly invoiced_at: Date | null;
  readonly status: 'open' | 'closed';
  readonly closed_at: Date | null;
  readonly erases_at: Date | null;
  readonly created_at: Date;
}

export interface CharterLineRow {
  readonly charter_id: string;
  readonly line_index: number;
  readonly kind: string;
  readonly label: string;
  readonly eur_minor: string;
  readonly amount_minor: string;
}

export function charterJson(
  charter: CharterRow,
  yachtSlug: string,
  lines: readonly CharterLineRow[],
): Record<string, unknown> {
  return {
    id: charter.id,
    holdId: charter.hold_id,
    yachtSlug,
    weekStart: charter.week_start,
    weekEnd: charter.week_end,
    clientName: charter.client_name,
    clientEmail: charter.client_email,
    currency: charter.currency,
    season: charter.season,
    depositDate: charter.deposit_date,
    exchangeTableId: charter.exchange_table_id,
    rate: charter.rate,
    lines: lines.map((line) => ({
      kind: line.kind,
      label: line.label,
      eurMinor: Number(line.eur_minor),
      amountMinor: Number(line.amount_minor),
    })),
    totalEurMinor: Number(charter.total_eur_minor),
    totalMinor: Number(charter.total_minor),
    invoiceStatus: charter.invoice_status,
    killbillInvoiceId: charter.killbill_invoice_id,
    invoicedAt: charter.invoiced_at === null ? null : toInstantString(charter.invoiced_at),
    status: charter.status,
    closedAt: charter.closed_at === null ? null : toInstantString(charter.closed_at),
    erasesAt: charter.erases_at === null ? null : toInstantString(charter.erases_at),
  };
}

export interface InsertCharterOptions {
  readonly workspaceId: string;
  readonly yachtId: string;
  readonly holdId: string | null;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly clientName: string;
  readonly clientEmail: string;
  readonly currency: string;
  readonly season: Season;
  readonly depositDate: string | null;
  readonly exchangeTableId: string | null;
  readonly rate: string;
  readonly quote: CharterQuote;
}

/** Stores a charter with its priced lines, which are never recomputed afterwards. */
export async function insertCharter(
  client: PoolClient,
  options: InsertCharterOptions,
  now: Date,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO charters (id, workspace_id, yacht_id, hold_id, week_start, week_end, client_name,
        client_email, currency, season, deposit_date, exchange_table_id, rate, total_eur_minor,
        total_minor, invoice_status, status, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'not_invoiced','open',$16)`,
    [
      id,
      options.workspaceId,
      options.yachtId,
      options.holdId,
      options.weekStart,
      options.weekEnd,
      options.clientName,
      options.clientEmail,
      options.currency,
      options.season,
      options.depositDate,
      options.exchangeTableId,
      options.rate,
      options.quote.totalEurMinor.toString(),
      options.quote.totalMinor.toString(),
      now,
    ],
  );
  for (const [index, line] of options.quote.lines.entries()) {
    await client.query(
      `INSERT INTO charter_lines (charter_id, line_index, kind, label, eur_minor, amount_minor)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, index, line.kind, line.label, line.eurMinor.toString(), line.amountMinor.toString()],
    );
  }
  return id;
}

