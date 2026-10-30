import type { ComplianceDocument, DocumentState, DocumentType } from '../../shared/types.js';
import { DOCUMENT_LABELS } from '../../shared/types.js';
import { query, type Sql } from '../db/pool.js';
import { addDays } from './time.js';

export const EXPIRING_WINDOW_DAYS = 14;

export interface DocumentRow {
  id: string;
  kitchen_id: string;
  member_id: string;
  type: DocumentType;
  state: 'uploaded' | 'verified' | 'rejected';
  expires_on: string | null;
  original_name: string;
  size_bytes: number;
  content_type: string;
  uploaded_at: Date;
  reject_reason: string | null;
  storage_key: string;
  business?: string;
}

/** The state a document reads as on a kitchen date. */
export function documentState(row: DocumentRow, today: string): DocumentState {
  if (row.state === 'rejected') return 'rejected';
  if (row.expires_on === null) return row.state;
  if (today > row.expires_on) return 'expired';
  if (row.state === 'uploaded') return 'uploaded';
  return today >= addDays(row.expires_on, -EXPIRING_WINDOW_DAYS) ? 'expiring' : 'verified';
}

export function documentView(row: DocumentRow, today: string): ComplianceDocument {
  const view: ComplianceDocument = {
    id: row.id,
    member_id: row.member_id,
    type: row.type,
    label: DOCUMENT_LABELS[row.type],
    state: documentState(row, today),
    expires_on: row.expires_on,
    original_name: row.original_name,
    size_bytes: row.size_bytes,
    content_type: row.content_type,
    uploaded_at: row.uploaded_at.toISOString(),
    reject_reason: row.reject_reason,
  };
  if (row.business !== undefined) view.business = row.business;
  return view;
}

export const DOCUMENT_COLUMNS = `d.id, d.kitchen_id, d.member_id, d.type, d.state, d.expires_on,
  d.original_name, d.size_bytes, d.content_type, d.uploaded_at, d.reject_reason, d.storage_key`;

/**
 * A member's cover runs to the earlier of the latest unexpired verified
 * insurance expiry and the latest unexpired verified food-handler expiry. It is
 * null when either is missing.
 */
export async function coveredUntil(
  client: Sql,
  memberId: string,
  today: string,
): Promise<string | null> {
  const rows = await query<{ type: DocumentType; latest: string | null }>(
    client,
    `SELECT type, max(expires_on)::text AS latest
       FROM documents
      WHERE member_id = $1 AND state = 'verified' AND expires_on IS NOT NULL
        AND expires_on >= $2::date AND type IN ('insurance', 'food_handler')
      GROUP BY type`,
    [memberId, today],
  );
  const insurance = rows.find((row) => row.type === 'insurance')?.latest ?? null;
  const foodHandler = rows.find((row) => row.type === 'food_handler')?.latest ?? null;
  if (insurance === null || foodHandler === null) return null;
  return insurance < foodHandler ? insurance : foodHandler;
}

export function dateIsCovered(coveredThrough: string | null, date: string): boolean {
  return coveredThrough !== null && date <= coveredThrough;
}
