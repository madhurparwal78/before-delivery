import type { DbClient } from '../platform/db.js';
import { errors } from '../platform/errors.js';
import { writeAudit } from '../platform/audit.js';
import { validateClaims } from '../domain/claims.js';
import type { ClaimInput, ReleaseRecordStatus } from '../domain/lifecycles.js';
import { releaseRecordStatus } from '../domain/lifecycles.js';
import { chartGroupsFor, getContentById, type ContentRow } from './content.js';
import type { RowView } from '../domain/lifecycles.js';

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
  last_validation: unknown;
  cleared_by: string | null;
  cleared_at: Date | null;
};

export async function getReleaseRecord(client: DbClient, contentId: string): Promise<ReleaseRecordRow | null> {
  const rows = await client.query<ReleaseRecordRow>(
    `SELECT content_id, status, safety_by, safety_at, safety_note, legal_by, legal_at, legal_note,
            claims_validated_at, last_validation, cleared_by, cleared_at
     FROM release_records WHERE content_id = $1`,
    [contentId],
  );
  return rows.rows[0] ?? null;
}

function recordView(row: ReleaseRecordRow): Record<string, unknown> {
  const safety =
    row.safety_by !== null
      ? { by: row.safety_by, at: new Date(row.safety_at as Date).toISOString(), note: row.safety_note ?? '' }
      : null;
  const legal =
    row.legal_by !== null
      ? { by: row.legal_by, at: new Date(row.legal_at as Date).toISOString(), note: row.legal_note ?? '' }
      : null;
  return {
    status: row.status,
    safety,
    legal,
    claims_validated_at: row.claims_validated_at ? new Date(row.claims_validated_at).toISOString() : null,
    cleared_by: row.cleared_by,
    cleared_at: row.cleared_at ? new Date(row.cleared_at).toISOString() : null,
    last_validation: Array.isArray(row.last_validation) ? row.last_validation : null,
  };
}

export async function recordSignoff(
  client: DbClient,
  content: ContentRow,
  actor: string,
  kind: 'safety' | 'legal',
  note: string,
): Promise<Record<string, unknown>> {
  // Lock the record so concurrent sign-offs apply one at a time.
  const locked = await client.query<ReleaseRecordRow>(
    `SELECT * FROM release_records WHERE content_id = $1 FOR UPDATE`,
    [content.id],
  );
  const row = locked.rows[0];
  if (!row) throw errors.notFoundConsole();
  if (content.status !== 'in_review' && content.status !== 'approved') {
    throw errors.illegalTransition(content.status, `${kind}_signed`);
  }
  if (kind === 'safety') {
    if (row.safety_by) throw errors.alreadySigned();
    if (row.legal_by === actor) throw errors.distinctApproverRequired();
  } else {
    if (row.legal_by) throw errors.alreadySigned();
    if (row.safety_by === actor) throw errors.distinctApproverRequired();
  }
  const now = new Date();
  if (kind === 'safety') {
    await client.query(
      `UPDATE release_records SET safety_by = $1, safety_at = $2, safety_note = $3, status = $4
       WHERE content_id = $5`,
      [actor, now.toISOString(), note, releaseRecordStatus(true, row.legal_by !== null), content.id],
    );
  } else {
    await client.query(
      `UPDATE release_records SET legal_by = $1, legal_at = $2, legal_note = $3, status = $4
       WHERE content_id = $5`,
      [actor, now.toISOString(), note, releaseRecordStatus(row.safety_by !== null, true), content.id],
    );
  }
  await writeAudit(client, {
    actor,
    action: kind === 'safety' ? 'signoff.safety' : 'signoff.legal',
    targetType: 'release_record',
    targetId: content.id,
    detail: { content: content.slug, title: content.title, note },
  });
  const updated = await getReleaseRecord(client, content.id);
  return recordView(updated as ReleaseRecordRow);
}

export type LapseCheck = { lapsed: false } | { lapsed: true; kind: 'safety' | 'legal' };

export async function checkSignoffLapse(client: DbClient, contentId: string): Promise<LapseCheck> {
  const rows = await client.query<{ safety_by: string | null; legal_by: string | null; status: string }>(
    `SELECT safety_by, legal_by, status FROM release_records WHERE content_id = $1`,
    [contentId],
  );
  const row = rows.rows[0];
  if (!row) return { lapsed: false };
  if (row.status === 'cleared') return { lapsed: false };
  for (const kind of ['safety', 'legal'] as const) {
    const signer = kind === 'safety' ? row.safety_by : row.legal_by;
    if (!signer) continue;
    const active = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM grants
       WHERE staff_email = $1 AND role = 'approver' AND revoked_at IS NULL AND expires_at > now()`,
      [signer],
    );
    if ((active.rows[0]?.n ?? 0) === 0) {
      return { lapsed: true, kind };
    }
  }
  return { lapsed: false };
}

export async function runClaimValidation(
  client: DbClient,
  content: ContentRow,
): Promise<{ valid: boolean; view: Record<string, unknown> }> {
  const groups = await chartGroupsFor(client, content.slug);
  const rows: RowView[] = groups.flatMap((g) => g.rows);
  const comparatorNames: Record<string, string> = {};
  const comparatorRows = await client.query<{ slug: string; name: string }>(`SELECT slug, name FROM comparators`);
  for (const c of comparatorRows.rows) comparatorNames[c.slug] = c.name;
  const modelRows = await client.query<{ slug: string; title: string }>(`SELECT slug, title FROM content_items WHERE kind = 'model'`);
  for (const m of modelRows.rows) comparatorNames[m.slug] = m.title;
  const outcome = validateClaims({
    routeSlug: content.slug,
    routeTitle: content.title,
    body: content.body,
    claims: (content.claims ?? []) as ClaimInput[],
    comparatorNames,
    rows,
  });
  return { valid: outcome.valid, view: { valid: outcome.valid, results: outcome.results, bodyIssues: outcome.bodyIssues } };
}

export async function voidSignoffsFor(
  client: DbClient,
  contentId: string,
  actor: string,
  reason: 'signoff_lapsed',
  kind?: 'safety' | 'legal',
  signer?: string,
): Promise<void> {
  const rows = await client.query<ReleaseRecordRow>(
    `SELECT * FROM release_records WHERE content_id = $1 FOR UPDATE`,
    [contentId],
  );
  const row = rows.rows[0];
  if (!row || row.status === 'cleared' || row.status === 'open') return;
  if (kind === 'safety') {
    await client.query(
      `UPDATE release_records SET safety_by = NULL, safety_at = NULL, safety_note = NULL,
         status = $1, claims_validated_at = NULL, last_validation = NULL
       WHERE content_id = $2`,
      [releaseRecordStatus(false, row.legal_by !== null), contentId],
    );
  } else if (kind === 'legal') {
    await client.query(
      `UPDATE release_records SET legal_by = NULL, legal_at = NULL, legal_note = NULL,
         status = $1, claims_validated_at = NULL, last_validation = NULL
       WHERE content_id = $2`,
      [releaseRecordStatus(row.safety_by !== null, false), contentId],
    );
  } else {
    await client.query(
      `UPDATE release_records SET safety_by = NULL, safety_at = NULL, safety_note = NULL,
         legal_by = NULL, legal_at = NULL, legal_note = NULL,
         status = 'open', claims_validated_at = NULL, last_validation = NULL
       WHERE content_id = $1`,
      [contentId],
    );
  }
  await writeAudit(client, {
    actor,
    action: 'release_record.void',
    targetType: 'release_record',
    targetId: contentId,
    detail: { reason, kind: kind ?? 'safety', signer: signer ?? '' },
  });
}

export async function recordStatus(client: DbClient, contentId: string): Promise<ReleaseRecordStatus | null> {
  const rows = await client.query<{ status: ReleaseRecordStatus }>(
    `SELECT status FROM release_records WHERE content_id = $1`,
    [contentId],
  );
  return rows.rows[0]?.status ?? null;
}

export function viewReleaseRecord(row: ReleaseRecordRow | null): Record<string, unknown> | null {
  return row ? recordView(row) : null;
}

export { getContentById };
