import type { Tx } from './db.js';
import { healthTimeline, promotionHistory, windowDecisions, type PromotionRow } from './repo.js';
import { nextSnapshotNumber, recordObject } from './services/queues.js';
import { StorageUnreachable, putObject } from './services/storage.js';

function evidenceKey(projectSlug: string, promotionId: string, number: number): string {
  return `evidence/${projectSlug}/${promotionId}/${String(number).padStart(3, '0')}.json`;
}

export function bundleKey(projectSlug: string, digest: string): string {
  return `bundles/${projectSlug}/${digest.replace(/^sha256:/, '')}.json`;
}

async function snapshotBytes(tx: Tx, row: PromotionRow, number: number): Promise<Buffer> {
  const [decisions, timeline, history] = await Promise.all([
    windowDecisions(row.id, tx),
    healthTimeline(row.id, tx),
    promotionHistory(row.id, tx),
  ]);

  const snapshot = {
    snapshot: number,
    promotion_id: row.id,
    project: row.project_slug,
    stage: row.stage_name,
    cluster: row.cluster_name,
    time_zone: row.time_zone,
    kind: row.kind,
    bundle: {
      version: row.bundle_version,
      digest: row.bundle_digest,
      source_commit: row.bundle_source_commit,
    },
    overrides: row.overrides,
    requested_by: row.requester_email,
    requested_at: row.requested_at.toISOString(),
    policy_version: row.policy_version,
    state: row.state,
    diff: row.diff,
    approvals: row.approval_required
      ? {
          decision: row.approval_state,
          by: row.approval_decided_by,
          at: row.approval_decided_at?.toISOString() ?? null,
          expires_at: row.approval_expires_at?.toISOString() ?? null,
          comment: row.approval_comment,
        }
      : null,
    window_decisions: decisions,
    freeze_breaks: row.freeze_break ? [row.freeze_break] : [],
    health_timeline: timeline,
    history,
    restores: row.restores_promotion_id,
  };

  return Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8');
}

/**
 * Writes the next numbered evidence snapshot. When storage is unreachable the snapshot waits in
 * the queue and the caller's action still succeeds.
 */
export async function writeSnapshot(tx: Tx, row: PromotionRow): Promise<void> {
  const number = await nextSnapshotNumber(tx, row.id);
  const objectKey = evidenceKey(row.project_slug, row.id, number);
  const body = await snapshotBytes(tx, row, number);
  let stored = true;
  try {
    await putObject(objectKey, body);
  } catch (cause) {
    if (!(cause instanceof StorageUnreachable)) throw cause;
    stored = false;
  }
  await recordObject(tx, { objectKey, body, promotionId: row.id, snapshotNumber: number, stored });
}

/** Records a snapshot straight into the queue, which is where seeded evidence starts life. */
export async function queueSnapshot(tx: Tx, row: PromotionRow): Promise<void> {
  const number = await nextSnapshotNumber(tx, row.id);
  const objectKey = evidenceKey(row.project_slug, row.id, number);
  const body = await snapshotBytes(tx, row, number);
  await recordObject(tx, { objectKey, body, promotionId: row.id, snapshotNumber: number, stored: false });
}

/**
 * Writes the approval decision snapshot, which must reach storage before the decision is
 * recorded. An unreachable store throws, so the whole approval is abandoned.
 */
export async function writeSnapshotBeforeDecision(tx: Tx, row: PromotionRow): Promise<void> {
  const number = await nextSnapshotNumber(tx, row.id);
  const objectKey = evidenceKey(row.project_slug, row.id, number);
  const body = await snapshotBytes(tx, row, number);
  await putObject(objectKey, body);
  await recordObject(tx, { objectKey, body, promotionId: row.id, snapshotNumber: number, stored: true });
}
