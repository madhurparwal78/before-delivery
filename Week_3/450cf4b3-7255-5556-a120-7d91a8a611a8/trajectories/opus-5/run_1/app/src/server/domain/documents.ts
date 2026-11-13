import { query, type Db } from '../db';
import { daysBetween } from '../../shared/format';
import type { CoverState, DocumentKind } from '../../shared/types';

export interface DocumentRow {
  id: string;
  tenant_id: string;
  kind: DocumentKind;
  expires_on: string;
  per_occurrence_limit: number | null;
  additional_insured: boolean | null;
  content_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  has_file: boolean;
  object_key: string | null;
  uploaded_at: Date;
}

export const DOCUMENT_COLUMNS = `id, tenant_id, kind, expires_on::text as expires_on, per_occurrence_limit,
  additional_insured, content_type, size_bytes, sha256, has_file, object_key, uploaded_at`;

export interface CurrentDocuments {
  insurance: DocumentRow | null;
  foodHandler: DocumentRow | null;
}

export async function documentsOfTenant(client: Db, tenantId: string): Promise<DocumentRow[]> {
  return query<DocumentRow>(
    client,
    `select ${DOCUMENT_COLUMNS} from documents where tenant_id = $1 order by uploaded_at desc, id desc`,
    [tenantId],
  );
}

export function currentOf(documents: ReadonlyArray<DocumentRow>): CurrentDocuments {
  const newestFirst = [...documents].sort(
    (left, right) => right.uploaded_at.getTime() - left.uploaded_at.getTime(),
  );
  return {
    insurance: newestFirst.find((row) => row.kind === 'insurance_certificate') ?? null,
    foodHandler: newestFirst.find((row) => row.kind === 'food_handler_card') ?? null,
  };
}

export async function currentDocuments(client: Db, tenantId: string): Promise<CurrentDocuments> {
  return currentOf(await documentsOfTenant(client, tenantId));
}

export function isCurrentDocument(document: DocumentRow, current: CurrentDocuments): boolean {
  const currentOfKind = document.kind === 'insurance_certificate' ? current.insurance : current.foodHandler;
  return currentOfKind !== null && currentOfKind.id === document.id;
}

/** One cover rule: a document covers a kitchen date on or before its expiry date. */
export function coversDate(document: DocumentRow | null, date: string): boolean {
  if (document === null) return false;
  return daysBetween(date, document.expires_on) >= 0;
}

export interface CoverReading {
  coverState: CoverState;
  daysLeft: number | null;
}

export function coverReading(document: DocumentRow, current: boolean, today: string): CoverReading {
  if (!current) return { coverState: 'superseded', daysLeft: null };
  const days = daysBetween(today, document.expires_on);
  if (days < 0) return { coverState: 'lapsed', daysLeft: null };
  if (days === 0) return { coverState: 'expires_today', daysLeft: 0 };
  if (days <= 7) return { coverState: 'expires_soon', daysLeft: days };
  return { coverState: 'ok', daysLeft: days };
}

export function objectExtension(contentType: string): 'pdf' | 'png' | 'jpg' {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'image/png') return 'png';
  return 'jpg';
}

export function objectKeyFor(tenantId: string, documentId: string, contentType: string): string {
  return `tenants/${tenantId}/documents/${documentId}.${objectExtension(contentType)}`;
}
