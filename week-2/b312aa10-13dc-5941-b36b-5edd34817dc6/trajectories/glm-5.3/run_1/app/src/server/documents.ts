import type { PoolClient } from 'pg';
import { addDays } from './time.js';

export type DocumentType = 'insurance_certificate' | 'food_handler_card';

export interface DocumentRow {
  id: string;
  kitchen_id: string;
  member_id: string;
  type: DocumentType;
  expiry_date: string;
  status: 'submitted' | 'approved' | 'expiring' | 'expired' | 'superseded';
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: Date;
  approved_at: Date | null;
  version: number;
  superseded: boolean;
  seed: boolean;
}

/** Days remaining: the expiry date minus the kitchen-local today. */
export function daysRemaining(expiryDate: string, today: string): number {
  const a = Date.parse(`${expiryDate}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  return Math.round((a - b) / 86400000);
}

/** Expiry status of an approved document, judged against the kitchen-local today. */
export function expiryStatus(expiryDate: string, today: string): 'approved' | 'expiring' | 'expired' {
  const d = daysRemaining(expiryDate, today);
  if (d < 0) return 'expired';
  if (d <= 14) return 'expiring';
  return 'approved';
}

export interface CurrentDocument {
  row: DocumentRow;
  daysRemaining: number;
}

/**
 * A member's current document of a type: the approved one (approved, expiring
 * or expired) with the latest expiry date. Superseded documents never count.
 */
export async function currentDocument(
  client: PoolClient,
  memberId: string,
  type: DocumentType,
  today: string,
): Promise<CurrentDocument | null> {
  const result = await client.query<DocumentRow>(
    `SELECT * FROM documents WHERE member_id=$1 AND type=$2 AND superseded=false AND approved_at IS NOT NULL ORDER BY expiry_date DESC, uploaded_at ASC LIMIT 1`,
    [memberId, type],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { row, daysRemaining: daysRemaining(row.expiry_date, today) };
}

/** A document expires at 24:00 kitchen time at the end of its expiry date. */
export function documentExpiryInstant(expiryDate: string, timeZone: string): Date {
  const dayAfter = addDays(expiryDate, 1);
  const result = new Date(Date.parse(`${dayAfter}T00:00:00Z`));
  // Resolve to the true local-midnight instant in the zone.
  const probe = new Date(Date.parse(`${expiryDate}T12:00:00Z`));
  void probe;
  void timeZone;
  // Offsets rarely shift at midnight; compute using the offset in force near midnight.
  const base = Date.parse(`${dayAfter}T00:00:00Z`);
  for (const off of [-300, -240, -360, -180, 0, 300, 240, 180, 60, -60]) {
    const candidate = new Date(base - off * 60000);
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const parts = fmt.formatToParts(candidate);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    if (get('hour') === '00' && get('minute') === '00' && `${get('year')}-${get('month')}-${get('day')}` === dayAfter) {
      return candidate;
    }
  }
  return result;
}

/** Document type display name. */
export const documentTypeName = (type: DocumentType): string =>
  type === 'insurance_certificate' ? 'insurance certificate' : 'food-handler card';
