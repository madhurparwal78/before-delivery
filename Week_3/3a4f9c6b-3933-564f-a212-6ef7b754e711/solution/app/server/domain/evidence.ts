// Numbered evidence snapshots (brief: Services, Evidence snapshots). Each is written to the database
// first and uploaded by the drain, except the approval snapshot, which is stored before anything is recorded.
import type { Tx } from "../db.js";
import { putObject } from "../storage.js";
import { loadPromotions, type Loaded } from "./records.js";

export function evidenceKey(project: string, promotionId: string, number: number): string {
  return `evidence/${project}/${promotionId}/${String(number).padStart(3, "0")}.json`;
}

function snapshotBytes({ view, row }: Loaded, number: number): Buffer {
  const approvals = [];
  if (view.approval?.decided_by) {
    approvals.push({
      decision: row.approval_expires_at ? "approved" : "rejected",
      by: view.approval.decided_by,
      at: view.approval.decided_at,
      expires_at: view.approval.expires_at,
      comment: view.approval.comment,
    });
  }
  if (view.approval?.state === "expired") {
    approvals.push({
      decision: "expired",
      by: "system",
      at: view.history.findLast((h) => h.to === "expired")?.at ?? null,
      expires_at: view.approval.expires_at ?? view.approval.request_expires_at,
      comment: null,
    });
  }
  const snapshot = {
    snapshot: number,
    promotion_id: view.id,
    project: view.project,
    stage: view.stage,
    cluster: view.cluster,
    time_zone: view.time_zone,
    kind: view.kind,
    bundle: { version: view.bundle.version, digest: view.bundle.digest, source_commit: view.bundle.source_commit },
    overrides: view.overrides,
    requested_by: view.requested_by,
    requested_at: view.requested_at,
    policy_version: view.policy_version,
    state: view.state,
    diff: view.diff,
    approvals,
    window_decisions: row.window_decisions,
    freeze_breaks: row.freeze_break ? [row.freeze_break] : [],
    health_timeline: row.health_timeline,
    history: view.history,
    restores: view.restores,
  };
  return Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

async function nextSnapshot(tx: Tx, promotionId: string): Promise<{ number: number; bytes: Buffer; project: string }> {
  const { rows } = await tx.query<{ next: number }>(
    "SELECT coalesce(max(number), 0)::int + 1 AS next FROM evidence_snapshots WHERE promotion_id = $1", [promotionId]);
  const number = rows[0]?.next ?? 1;
  const [loaded] = await loadPromotions(tx, [promotionId]);
  return { number, bytes: snapshotBytes(loaded as Loaded, number), project: (loaded as Loaded).view.project };
}

/** Records the next snapshot of the promotion as it stands now; the drain uploads it. */
export async function queueSnapshot(tx: Tx, promotionId: string, at: Date): Promise<void> {
  const { number, bytes } = await nextSnapshot(tx, promotionId);
  await tx.query("INSERT INTO evidence_snapshots (promotion_id, number, body, created_at) VALUES ($1, $2, $3, $4)",
    [promotionId, number, bytes, at]);
}

/** Uploads the next snapshot before recording it; throws 503 storage_unavailable if the upload fails. */
export async function storeSnapshotNow(tx: Tx, promotionId: string, at: Date): Promise<void> {
  const { number, bytes, project } = await nextSnapshot(tx, promotionId);
  await putObject(evidenceKey(project, promotionId, number), bytes, "Evidence storage is unreachable, so the approval was not recorded.");
  await tx.query("INSERT INTO evidence_snapshots (promotion_id, number, body, created_at, stored_at) VALUES ($1, $2, $3, $4, $4)",
    [promotionId, number, bytes, at]);
}
