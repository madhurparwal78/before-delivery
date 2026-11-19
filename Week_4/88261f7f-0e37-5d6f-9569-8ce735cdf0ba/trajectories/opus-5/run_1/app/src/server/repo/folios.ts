import { randomUUID } from 'node:crypto';
import { Db, one, rows } from '../db';
import { PlainDate } from '../../shared/dates';
import { isEmailAddress } from '../../shared/email';
import { folioNameForIndex } from '../../shared/folioNames';

export type EntryKind = 'charge' | 'payment';

export interface EntryView {
  id: string;
  kind: EntryKind;
  date: PlainDate;
  description: string;
  amountCents: number;
  roomNumber: string | null;
  reversesEntryId: string | null;
  splitOfEntryId: string | null;
}

export interface InvoiceView {
  id: string;
  number: string;
  state: 'issued';
  mailState: 'not_sent' | 'sent';
  billToName: string;
  payerEmail: string;
  pdfUrl: string;
}

export interface FolioView {
  id: string;
  name: string;
  payerName: string;
  payerEmail: string;
  state: 'open' | 'closed';
  balanceCents: number;
  entries: EntryView[];
  invoice: InvoiceView | null;
}

/** A payer email may be blank, but anything written there must be an address. */
export function isValidPayerEmail(value: string): boolean {
  return value.trim() === '' || isEmailAddress(value);
}

interface EntryRow {
  id: string;
  kind: string;
  date: string;
  description: string;
  amount_cents: number;
  room_number: string | null;
  reverses_entry_id: string | null;
  split_of_entry_id: string | null;
}

interface FolioRow {
  id: string;
  stay_id: string;
  name: string;
  payer_name: string;
  payer_email: string;
  state: string;
  ord: number;
}

interface InvoiceRow {
  id: string;
  folio_id: string;
  number: string;
  state: string;
  mail_state: string;
  bill_to_name: string;
  payer_email: string;
}

export function invoicePdfUrl(invoiceId: string): string {
  return `/api/invoices/${invoiceId}/pdf`;
}

function toEntry(row: EntryRow): EntryView {
  return {
    id: row.id,
    kind: row.kind as EntryKind,
    date: row.date,
    description: row.description,
    amountCents: row.amount_cents,
    roomNumber: row.room_number,
    reversesEntryId: row.reverses_entry_id,
    splitOfEntryId: row.split_of_entry_id,
  };
}

export function balanceOf(entries: EntryView[]): number {
  return entries.reduce(
    (total, entry) => total + (entry.kind === 'charge' ? entry.amountCents : -entry.amountCents),
    0,
  );
}

export async function listFolios(db: Db, stayId: string): Promise<FolioView[]> {
  const folioRows = await rows<FolioRow>(
    db,
    `select id, stay_id, name, payer_name, payer_email, state, ord
       from folios where stay_id = $1 order by ord`,
    [stayId],
  );
  if (folioRows.length === 0) return [];
  const ids = folioRows.map((row) => row.id);
  const entryRows = await rows<EntryRow & { folio_id: string }>(
    db,
    `select id, folio_id, kind, date, description, amount_cents, room_number,
            reverses_entry_id, split_of_entry_id
       from entries where folio_id = any($1::text[]) order by seq`,
    [ids],
  );
  const invoiceRows = await rows<InvoiceRow>(
    db,
    `select id, folio_id, number, state, mail_state, bill_to_name, payer_email
       from invoices where folio_id = any($1::text[])`,
    [ids],
  );
  return folioRows.map((row) => {
    const entries = entryRows.filter((entry) => entry.folio_id === row.id).map(toEntry);
    const invoiceRow = invoiceRows.find((invoice) => invoice.folio_id === row.id);
    return {
      id: row.id,
      name: row.name,
      payerName: row.payer_name,
      payerEmail: row.payer_email,
      state: row.state as 'open' | 'closed',
      balanceCents: balanceOf(entries),
      entries,
      invoice: invoiceRow
        ? {
            id: invoiceRow.id,
            number: invoiceRow.number,
            state: 'issued',
            mailState: invoiceRow.mail_state as 'not_sent' | 'sent',
            billToName: invoiceRow.bill_to_name,
            payerEmail: invoiceRow.payer_email,
            pdfUrl: invoicePdfUrl(invoiceRow.id),
          }
        : null,
    };
  });
}

export interface FolioRecord {
  id: string;
  stayId: string;
  name: string;
  payerName: string;
  payerEmail: string;
  state: 'open' | 'closed';
  ord: number;
}

export async function loadFolioRecord(db: Db, folioId: string): Promise<FolioRecord | null> {
  const row = await one<FolioRow>(
    db,
    'select id, stay_id, name, payer_name, payer_email, state, ord from folios where id = $1',
    [folioId],
  );
  return row
    ? {
        id: row.id,
        stayId: row.stay_id,
        name: row.name,
        payerName: row.payer_name,
        payerEmail: row.payer_email,
        state: row.state as 'open' | 'closed',
        ord: row.ord,
      }
    : null;
}

export async function loadEntryRecord(
  db: Db,
  entryId: string,
): Promise<(EntryView & { folioId: string }) | null> {
  const row = await one<EntryRow & { folio_id: string }>(
    db,
    `select id, folio_id, kind, date, description, amount_cents, room_number,
            reverses_entry_id, split_of_entry_id
       from entries where id = $1`,
    [entryId],
  );
  return row ? { ...toEntry(row), folioId: row.folio_id } : null;
}

export async function createFolio(
  db: Db,
  stayId: string,
  payerName: string,
  payerEmail: string,
): Promise<FolioRecord> {
  const next = await one<{ ord: number }>(
    db,
    'select coalesce(max(ord) + 1, 0) as ord from folios where stay_id = $1',
    [stayId],
  );
  const ord = next ? next.ord : 0;
  const id = randomUUID();
  const name = folioNameForIndex(ord);
  await db.query(
    `insert into folios (id, stay_id, name, payer_name, payer_email, state, ord)
     values ($1, $2, $3, $4, $5, 'open', $6)`,
    [id, stayId, name, payerName, payerEmail, ord],
  );
  return { id, stayId, name, payerName, payerEmail, state: 'open', ord };
}

export interface NewEntry {
  folioId: string;
  kind: EntryKind;
  date: PlainDate;
  description: string;
  amountCents: number;
  roomNumber?: string | null;
  reversesEntryId?: string | null;
  splitOfEntryId?: string | null;
}

export async function insertEntry(db: Db, entry: NewEntry): Promise<EntryView> {
  const id = randomUUID();
  await db.query(
    `insert into entries (id, folio_id, kind, date, description, amount_cents, room_number,
                          reverses_entry_id, split_of_entry_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      entry.folioId,
      entry.kind,
      entry.date,
      entry.description,
      entry.amountCents,
      entry.roomNumber ?? null,
      entry.reversesEntryId ?? null,
      entry.splitOfEntryId ?? null,
    ],
  );
  return {
    id,
    kind: entry.kind,
    date: entry.date,
    description: entry.description,
    amountCents: entry.amountCents,
    roomNumber: entry.roomNumber ?? null,
    reversesEntryId: entry.reversesEntryId ?? null,
    splitOfEntryId: entry.splitOfEntryId ?? null,
  };
}

/** A reversal, an already reversed entry and an already split entry cannot change again. */
export async function entryIsLocked(db: Db, entry: EntryView): Promise<boolean> {
  if (entry.reversesEntryId !== null) return true;
  const row = await one<{ count: number }>(
    db,
    `select count(*)::int as count from entries
      where reverses_entry_id = $1 or split_of_entry_id = $1`,
    [entry.id],
  );
  return row !== null && row.count > 0;
}

/** The stay's first open folio, or a new one with the next letter when none is open. */
export async function firstOpenFolio(
  db: Db,
  stayId: string,
  payerName: string,
  payerEmail: string,
): Promise<FolioRecord> {
  const row = await one<FolioRow>(
    db,
    `select id, stay_id, name, payer_name, payer_email, state, ord
       from folios where stay_id = $1 and state = 'open' order by ord limit 1`,
    [stayId],
  );
  if (row) {
    return {
      id: row.id,
      stayId: row.stay_id,
      name: row.name,
      payerName: row.payer_name,
      payerEmail: row.payer_email,
      state: 'open',
      ord: row.ord,
    };
  }
  return createFolio(db, stayId, payerName, payerEmail);
}

export const entryDescriptions = {
  roomCharge: (roomNumber: string): string => `Room charge, room ${roomNumber}`,
  tax: (roomNumber: string): string => `Tax, room ${roomNumber}`,
  cityTax: (roomNumber: string): string => `City tax, room ${roomNumber}`,
  noShowFee: 'No-show fee',
  lateCancellationFee: 'Late cancellation fee',
  cashPayment: 'Cash payment',
  cardPayment: (reference: string): string => `Card payment ${reference}`,
  reversalOf: (description: string): string => `Reversal of ${description}`,
  share: (description: string, percent: number): string => `${description} (${percent}%)`,
} as const;
