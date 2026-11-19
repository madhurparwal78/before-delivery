// Guide domain rules: state transitions, visibility, publish checks, running cost.
// Exactly one place decides each rule.

import type { PoolClient } from 'pg';
import { limits } from './limits';

export type GuideState = 'draft' | 'published' | 'withdrawn';

/** Guide state transitions; the table from Business rules. */
export function transition(from: GuideState, action: 'publish' | 'withdraw'):
  | { ok: true; to: GuideState }
  | { ok: false; error: 'illegal_transition'; from: GuideState; to: GuideState } {
  if (action === 'publish') return { ok: true, to: 'published' };
  if (from === 'published') return { ok: true, to: 'withdrawn' };
  return { ok: false, error: 'illegal_transition', from, to: 'withdrawn' as GuideState };
}

/** Publish checks in their published order, after the state check. */
export type PublishRefusal =
  | { error: 'no_version' }
  | { error: 'model_not_stored' }
  | { error: 'storage_unavailable' }
  | { error: 'unbound_parts'; parts: string[] }
  | { error: 'scale_unconfirmed' };

export function checkPublish(guide: { latest_version: number | null; model_id: string | null; storageOk: boolean }, unboundParts: string[], scaleConfirmed: boolean | null): PublishRefusal | null {
  if (guide.latest_version === null) return { error: 'no_version' };
  if (guide.model_id === null) return { error: 'model_not_stored' };
  if (!guide.storageOk) return { error: 'storage_unavailable' };
  if (unboundParts.length > 0) return { error: 'unbound_parts', parts: unboundParts };
  if (scaleConfirmed !== true) return { error: 'scale_unconfirmed' };
  return null;
}

/** Who may see a guide at all. */
export function canSee(
  viewer: { id: string } | null,
  guide: { owner_id: string; visibility: 'public' | 'private'; state: GuideState; latest_version: number | null },
  isCoauthor: boolean,
): boolean {
  if (guide.owner_id === viewer?.id) return true;
  if (isCoauthor) return true;
  if (guide.visibility === 'private') return false;
  if (guide.state === 'draft') return false;
  if (guide.state === 'withdrawn') return true;
  return guide.latest_version !== null;
}

/** Reader page 404s when there is no saved version; the API shows it to owner and co-authors. */
export function canRead(viewer: { id: string } | null, guide: { owner_id: string; visibility: 'public' | 'private'; state: GuideState; latest_version: number | null }, isCoauthor: boolean): boolean {
  if (guide.owner_id === viewer?.id) return true;
  if (isCoauthor) return true;
  if (guide.state === 'withdrawn') return true;
  return guide.visibility === 'public' && guide.state === 'published' && guide.latest_version !== null;
}

/** Field revisions start at 0 and add 1 on every change. */
export async function bumpFieldRevision(client: PoolClient, guideId: string, fieldPath: string, by: string): Promise<number> {
  await client.query(
    `INSERT INTO field_revisions (guide_id, field_path, revision, updated_by)
     VALUES ($1, $2, 0, $3)
     ON CONFLICT (guide_id, field_path) DO NOTHING`,
    [guideId, fieldPath, by],
  );
  const result = await client.query<{ revision: number }>(
    `UPDATE field_revisions SET revision = revision + 1, updated_by = $3
     WHERE guide_id = $1 AND field_path = $2 RETURNING revision`,
    [guideId, fieldPath, by],
  );
  await client.query('UPDATE guides SET revision = revision + 1 WHERE id = $1', [guideId]);
  return result.rows[0].revision;
}

export async function ensureFieldRevision(client: PoolClient, guideId: string, fieldPath: string): Promise<void> {
  await client.query(
    `INSERT INTO field_revisions (guide_id, field_path, revision, updated_by)
     VALUES ($1, $2, 0, '') ON CONFLICT DO NOTHING`,
    [guideId, fieldPath],
  );
}
