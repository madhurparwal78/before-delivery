import type { Queryable } from '../db/pool.js';
import { appendAuditEntry } from './audit.js';
import type { ClaimVerdict } from './claims.js';

export type ReleaseRecordStatus =
  | 'open'
  | 'safety_signed'
  | 'legal_signed'
  | 'signed'
  | 'claims_validated'
  | 'cleared';

export type ReleaseRecordRow = {
  content_id: string;
  status: ReleaseRecordStatus;
  safety_by: string | null;
  safety_at: Date | null;
  safety_note: string | null;
  legal_by: string | null;
  legal_at: Date | null;
  legal_note: string | null;
  claims_validated_at: Date | null;
  last_validation: ClaimVerdict[] | null;
  cleared_by: string | null;
  cleared_at: Date | null;
};

export const RELEASE_RECORD_COLUMNS = `content_id, status, safety_by, safety_at, safety_note,
  legal_by, legal_at, legal_note, claims_validated_at, last_validation, cleared_by, cleared_at`;

export function signedState(
  safety: string | null,
  legal: string | null,
): 'open' | 'safety_signed' | 'legal_signed' | 'signed' {
  if (safety !== null && legal !== null) return 'signed';
  if (safety !== null) return 'safety_signed';
  if (legal !== null) return 'legal_signed';
  return 'open';
}

export async function loadReleaseRecord(
  tx: Queryable,
  contentId: string,
): Promise<ReleaseRecordRow | undefined> {
  const result = await tx.query<ReleaseRecordRow>(
    `SELECT ${RELEASE_RECORD_COLUMNS} FROM release_records WHERE content_id = $1`,
    [contentId],
  );
  return result.rows[0];
}

export function releaseRecordObject(row: ReleaseRecordRow): Record<string, unknown> {
  const signoff = (
    by: string | null,
    at: Date | null,
    note: string | null,
  ): Record<string, unknown> | null =>
    by === null || at === null ? null : { by, at: at.toISOString(), note: note ?? '' };
  return {
    status: row.status,
    safety: signoff(row.safety_by, row.safety_at, row.safety_note),
    legal: signoff(row.legal_by, row.legal_at, row.legal_note),
    claims_validated_at: row.claims_validated_at === null ? null : row.claims_validated_at.toISOString(),
    cleared_by: row.cleared_by,
    cleared_at: row.cleared_at === null ? null : row.cleared_at.toISOString(),
    last_validation: row.last_validation,
  };
}

/** Any edit to a model route empties its release record. */
export async function voidRecordForEdit(
  tx: Queryable,
  contentId: string,
  actor: string,
): Promise<void> {
  const result = await tx.query<{ status: ReleaseRecordStatus }>(
    `UPDATE release_records SET status='open', safety_by=NULL, safety_at=NULL, safety_note=NULL,
            legal_by=NULL, legal_at=NULL, legal_note=NULL, claims_validated_at=NULL,
            last_validation=NULL, cleared_by=NULL, cleared_at=NULL
      WHERE content_id=$1 AND status <> 'open'
      RETURNING status`,
    [contentId],
  );
  if ((result.rowCount ?? 0) === 0) return;
  await appendAuditEntry(tx, {
    actor,
    action: 'release_record.void',
    targetType: 'release_record',
    targetId: contentId,
    detail: { reason: 'route_edited' },
  });
}

/** Voids every sign-off a person made on a record that is not yet cleared. */
export async function voidLapsedSignoffs(
  tx: Queryable,
  signer: string,
  actor: string,
): Promise<void> {
  const affected = await tx.query<ReleaseRecordRow>(
    `SELECT ${RELEASE_RECORD_COLUMNS} FROM release_records
      WHERE status <> 'cleared' AND (safety_by = $1 OR legal_by = $1)
      FOR UPDATE`,
    [signer],
  );
  for (const record of affected.rows) {
    const kinds: ('safety' | 'legal')[] = [];
    if (record.safety_by === signer) kinds.push('safety');
    if (record.legal_by === signer) kinds.push('legal');
    const safety = record.safety_by === signer ? null : record.safety_by;
    const legal = record.legal_by === signer ? null : record.legal_by;
    await tx.query(
      `UPDATE release_records
          SET status = $2,
              safety_by = CASE WHEN $3 THEN NULL ELSE safety_by END,
              safety_at = CASE WHEN $3 THEN NULL ELSE safety_at END,
              safety_note = CASE WHEN $3 THEN NULL ELSE safety_note END,
              legal_by = CASE WHEN $4 THEN NULL ELSE legal_by END,
              legal_at = CASE WHEN $4 THEN NULL ELSE legal_at END,
              legal_note = CASE WHEN $4 THEN NULL ELSE legal_note END,
              claims_validated_at = NULL,
              last_validation = NULL
        WHERE content_id = $1`,
      [record.content_id, signedState(safety, legal), kinds.includes('safety'), kinds.includes('legal')],
    );
    for (const kind of kinds) {
      await appendAuditEntry(tx, {
        actor,
        action: 'release_record.void',
        targetType: 'release_record',
        targetId: record.content_id,
        detail: { reason: 'signoff_lapsed', kind, signer },
      });
    }
  }
}

/** True when a sign-off holder no longer holds an active approver grant. */
export async function signoffsLapsed(
  tx: Queryable,
  record: ReleaseRecordRow,
): Promise<boolean> {
  const signers = [record.safety_by, record.legal_by].filter(
    (value): value is string => value !== null,
  );
  if (signers.length === 0) return false;
  const result = await tx.query<{ staff_email: string }>(
    `SELECT staff_email FROM role_grants
      WHERE staff_email = ANY($1::text[]) AND role = 'approver'
        AND revoked_at IS NULL AND expires_at > now()`,
    [signers],
  );
  const active = new Set(result.rows.map((row) => row.staff_email));
  return signers.some((signer) => !active.has(signer));
}
