import type { BinderDocumentStatus, DocumentKind } from '../../shared/types.js';
import { query, type Db } from '../db/pool.js';
import { objectExists } from '../services/storage.js';

interface DocumentRecord {
  id: string;
  renter_id: string;
  kind: DocumentKind;
  valid_from: string;
  expires_on: string;
  storage_key: string;
}

const readableKeys = new Set<string>();

async function isReadable(key: string): Promise<boolean> {
  if (readableKeys.has(key)) return true;
  const present = await objectExists(key);
  if (present) readableKeys.add(key);
  return present;
}

/** Only documents whose stored object can be read count towards compliance. */
export async function readableDocuments(
  db: Db,
  renterIds: readonly string[],
  kind?: DocumentKind,
): Promise<DocumentRecord[]> {
  const rows = await query<DocumentRecord>(
    db,
    `SELECT id, renter_id, kind, valid_from, expires_on, storage_key
       FROM documents WHERE renter_id = ANY($1::text[])
       ${kind === undefined ? '' : 'AND kind = $2'}`,
    kind === undefined ? [renterIds] : [renterIds, kind],
  );
  const readable: DocumentRecord[] = [];
  for (const row of rows) {
    if (await isReadable(row.storage_key)) readable.push(row);
  }
  return readable;
}

export function coversDate(document: { valid_from: string; expires_on: string }, date: string): boolean {
  return document.valid_from <= date && date <= document.expires_on;
}

/** The liability certificate gate: every local date a booking touches must be covered. */
export async function uncoveredDates(
  db: Db,
  renterId: string,
  dates: readonly string[],
): Promise<string[]> {
  const certificates = await readableDocuments(db, [renterId], 'liability');
  return dates.filter(
    (date) => !certificates.some((certificate) => coversDate(certificate, date)),
  );
}

export function documentStatusOn(
  documents: readonly DocumentRecord[],
  kind: DocumentKind,
  date: string,
): BinderDocumentStatus {
  const ofKind = documents.filter((document) => document.kind === kind);
  const covering = ofKind.filter((document) => coversDate(document, date));
  if (covering.length > 0) {
    const latest = covering
      .map((document) => document.expires_on)
      .reduce((best, candidate) => (candidate > best ? candidate : best));
    return { status: 'current', expires_on: latest };
  }
  const expired = ofKind.filter((document) => document.expires_on < date);
  if (expired.length > 0) {
    const latest = expired
      .map((document) => document.expires_on)
      .reduce((best, candidate) => (candidate > best ? candidate : best));
    return { status: 'expired', expires_on: latest };
  }
  return { status: 'missing', expires_on: null };
}
