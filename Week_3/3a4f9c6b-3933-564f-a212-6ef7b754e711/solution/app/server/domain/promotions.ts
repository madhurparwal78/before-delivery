// Promotion actions: request, window check, approval decisions, start, re-check, freeze break,
// approval expiry, agent reports and rollback (brief: Business rules).
import { randomBytes } from "node:crypto";
import type { HealthValue, Overrides, SyncValue, SyncWindow } from "../../shared/api.js";
import type { User } from "../auth.js";
import { sha256Hex } from "../auth.js";
import { config } from "../config.js";
import { ACTIVE_STATES, type Db, type Tx } from "../db.js";
import { ApiError } from "../errors.js";
import { getObject } from "../storage.js";
import { type Manifest, diffRevisions } from "./diff.js";
import { queueSnapshot, storeSnapshotNow } from "./evidence.js";
import { pinnedPolicy, policyInForce } from "./freeze.js";
import { counters, createHealthRows, currentRevisions } from "./health.js";
import { queueNotice, type Notice } from "./notices.js";
import { railOf } from "./rail.js";
import { type Loaded, type PromotionRow, loadPromotions, lockPromotion } from "./records.js";
import { expectTrigger, moveTo, recordRequested } from "./transitions.js";
import { checkWindow } from "./windows.js";

export interface StageRow {
  id: string;
  project_id: string;
  name: string;
  cluster_id: string;
  cluster_name: string;
  time_zone: string;
  upstream_id: string | null;
  requires_approval: boolean;
  defaults: Overrides;
}

interface BundleRow { id: string; version: string; digest: string; object: Buffer }

interface BundleObject { version: string; source_commit: string; manifests: Manifest[] }

export const SYSTEM = "system";

/** The end of an approval request or a granted approval that starts at `at`. */
export const approvalDeadline = (at: Date) => new Date(at.getTime() + config.approvalTtlSeconds * 1000);

export async function stageByName(db: Db, projectId: string, name: string): Promise<StageRow | undefined> {
  const { rows } = await db.query<StageRow>(
    `SELECT s.id, s.project_id, s.name, s.cluster_id, c.name AS cluster_name, c.time_zone, s.upstream_id, s.requires_approval, s.defaults
       FROM stages s JOIN clusters c ON c.id = s.cluster_id WHERE s.project_id = $1 AND s.name = $2`, [projectId, name]);
  return rows[0];
}

export async function windowsOf(db: Db, clusterId: string): Promise<SyncWindow[]> {
  const { rows } = await db.query<SyncWindow>(
    `SELECT id, label, days, start_time AS start, end_time AS "end" FROM sync_windows
      WHERE cluster_id = $1 ORDER BY created_at, id`, [clusterId]);
  return rows;
}

/** The stage lock: a stage holds at most one active promotion; Postgres serialises the race on the stage row. */
async function lockStage(tx: Tx, stage: StageRow): Promise<void> {
  await tx.query("SELECT id FROM stages WHERE id = $1 FOR UPDATE", [stage.id]);
  const { rows } = await tx.query<{ id: string; state: string; version: string; digest: string }>(
    `SELECT x.id, x.state, b.version, b.digest FROM promotions x JOIN bundles b ON b.id = x.bundle_id
      WHERE x.stage_id = $1 AND x.state = ANY($2)`, [stage.id, ACTIVE_STATES]);
  const holder = rows[0];
  if (holder) {
    throw new ApiError("stage_busy", `${stage.name} is held by ${holder.version}.`, {
      holder: { promotion_id: holder.id, bundle_version: holder.version, bundle_digest: holder.digest, state: holder.state },
    });
  }
}

export async function revisionOf(db: Db, promotionId: string): Promise<{ manifests: Manifest[]; overrides: Overrides }> {
  const { rows } = await db.query<{ object: Buffer; overrides: Overrides }>(
    "SELECT b.object, x.overrides FROM promotions x JOIN bundles b ON b.id = x.bundle_id WHERE x.id = $1", [promotionId]);
  const row = rows[0] as { object: Buffer; overrides: Overrides };
  return { manifests: (JSON.parse(row.object.toString("utf8")) as BundleObject).manifests, overrides: row.overrides };
}

export async function enterApplying(tx: Tx, p: PromotionRow, trigger: "window_check" | "break_freeze", actor: string, at: Date): Promise<void> {
  await moveTo(tx, p, "applying", trigger, actor, at);
  await createHealthRows(tx, p.id, p.bundle_id, at);
  await tx.query("UPDATE promotions SET entered_applying_at = $2 WHERE id = $1", [p.id, at]);
}

export async function judgeWindow(tx: Tx, p: PromotionRow, stage: StageRow, at: Date) {
  const decision = checkWindow(at.getTime(), stage.name, stage.time_zone, await windowsOf(tx, stage.cluster_id),
    await pinnedPolicy(tx, p.project_id, p.policy_version));
  await tx.query("UPDATE promotions SET window_decisions = window_decisions || $2::jsonb WHERE id = $1",
    [p.id, JSON.stringify([decision])]);
  return decision;
}

/** The window check run as a promotion leaves queued. */
async function leaveQueued(tx: Tx, p: PromotionRow, stage: StageRow, at: Date): Promise<void> {
  const decision = await judgeWindow(tx, p, stage, at);
  if (decision.open) await enterApplying(tx, p, "window_check", SYSTEM, at);
  else await moveTo(tx, p, "window_blocked", "window_check", SYSTEM, at);
}

async function notify(tx: Tx, promotionId: string, notice: Notice, at: Date): Promise<void> {
  const [loaded] = await loadPromotions(tx, [promotionId]);
  await queueNotice(tx, (loaded as Loaded).view, notice, at);
}

interface NewPromotion {
  stage: StageRow;
  bundle: BundleRow;
  overrides: Overrides;
  requester: User;
  at: Date;
  restores: string | null;
}

/** Records a promotion (or rollback, when `restores` is set) and runs its automatic transitions. */
async function createPromotion(tx: Tx, input: NewPromotion): Promise<string> {
  const { stage, bundle, overrides, requester, at, restores } = input;
  const kind = restores ? "rollback" : "promotion";
  const current = (await currentRevisions(tx, [stage.id])).get(stage.id);
  const manifests = (JSON.parse(bundle.object.toString("utf8")) as BundleObject).manifests;
  const diff = diffRevisions({ manifests, overrides }, current ? await revisionOf(tx, current) : null);
  const policy = await policyInForce(tx, stage.project_id, at);
  const needsApproval = kind === "promotion" && stage.requires_approval;
  const token = needsApproval ? randomBytes(24).toString("base64url") : null;
  const { rows } = await tx.query<PromotionRow>(
    `INSERT INTO promotions (project_id, stage_id, kind, state, bundle_id, overrides, requested_by, requested_at, policy_version, diff,
                             approval_state, request_expires_at, approval_token_hash, restores)
     VALUES ($1, $2, $3, 'requested', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [stage.project_id, stage.id, kind, bundle.id, JSON.stringify(overrides), requester.id, at, policy.version, JSON.stringify(diff),
      needsApproval ? "pending" : null, needsApproval ? approvalDeadline(at) : null,
      token ? sha256Hex(token) : null, restores]);
  const p = rows[0] as PromotionRow;
  await recordRequested(tx, p.id, requester.email, at);
  if (token) {
    await moveTo(tx, p, "awaiting_approval", "request", SYSTEM, at);
    await notify(tx, p.id, { kind: "approval_requested", token }, at);
  } else {
    await moveTo(tx, p, "queued", "request", SYSTEM, at);
    await leaveQueued(tx, p, stage, at);
  }
  await queueSnapshot(tx, p.id, at);
  return p.id;
}

/** Stage defaults merged with the request (the request wins); replica refs not in the bundle are dropped. */
export function frozenOverrides(defaults: Overrides, request: Overrides, bundleRefs: Set<string>): Overrides {
  const replicas = Object.fromEntries(Object.entries(defaults.replicas).filter(([ref]) => bundleRefs.has(ref)));
  return { parameters: { ...defaults.parameters, ...request.parameters }, replicas: { ...replicas, ...request.replicas } };
}

export async function requestPromotion(tx: Tx, stage: StageRow, bundle: BundleRow, overrides: Overrides, requester: User, at: Date): Promise<string> {
  await lockStage(tx, stage);
  if (stage.upstream_id) {
    const { rows } = await tx.query(
      "SELECT 1 FROM promotions WHERE stage_id = $1 AND bundle_id = $2 AND healthy_at IS NOT NULL LIMIT 1", [stage.upstream_id, bundle.id]);
    if (rows.length === 0) throw new ApiError("not_verified_upstream", `${bundle.version} has not reached Healthy in the upstream stage yet.`);
  }
  return createPromotion(tx, { stage, bundle, overrides, requester, at, restores: null });
}

/** The states in which a promotion can lapse. */
export const LAPSING_STATES = ["awaiting_approval", "approved", "window_blocked"] as const;

/** Approval expiry: a request lapses at request_expires_at, a granted approval at expires_at (excluded). */
function lapseInstant(p: PromotionRow): Date | null {
  if (p.state === "awaiting_approval") return p.request_expires_at;
  if ((p.state === "approved" || p.state === "window_blocked") && p.kind === "promotion") return p.approval_expires_at;
  return null;
}

/** Whether the request or approval has lapsed at `at`. */
export function hasLapsed(p: PromotionRow, at: Date): boolean {
  const lapse = lapseInstant(p);
  return lapse !== null && at >= lapse;
}

/** Marks a lapsed promotion expired (one snapshot, one notice); answers whether it lapsed. */
export async function expireIfLapsed(tx: Tx, p: PromotionRow, at: Date): Promise<boolean> {
  if (!hasLapsed(p, at)) return false;
  await moveTo(tx, p, "expired", "lapse", SYSTEM, at);
  await tx.query("UPDATE promotions SET approval_state = 'expired' WHERE id = $1", [p.id]);
  await queueSnapshot(tx, p.id, at);
  await notify(tx, p.id, { kind: "expired" }, at);
  return true;
}

async function refuseIfLapsed(tx: Tx, p: PromotionRow, at: Date): Promise<void> {
  const awaiting = p.state === "awaiting_approval";
  if (await expireIfLapsed(tx, p, at)) {
    throw new ApiError("approval_expired", awaiting ? "This approval request has expired." : "This approval has expired.", {}, true);
  }
}

export async function approve(tx: Tx, id: string, user: User, comment: string | null, at: Date): Promise<void> {
  const p = await lockPromotion(tx, id);
  expectTrigger(p, "approve");
  await refuseIfLapsed(tx, p, at);
  const { rows } = await tx.query("SELECT 1 FROM evidence_snapshots WHERE promotion_id = $1 AND number = 1 AND stored_at IS NOT NULL", [id]);
  if (rows.length === 0) throw new ApiError("evidence_pending", "The evidence bundle is still being stored.");
  await tx.query(
    `UPDATE promotions SET approval_state = 'approved', decided_by = $2, decided_at = $3, approval_expires_at = $4, approval_comment = $5
      WHERE id = $1`, [id, user.id, at, approvalDeadline(at), comment]);
  await moveTo(tx, p, "approved", "approve", user.email, at);
  await storeSnapshotNow(tx, id, at);
  await notify(tx, id, { kind: "approved" }, at);
}

export async function reject(tx: Tx, id: string, user: User, reason: string, at: Date): Promise<void> {
  const p = await lockPromotion(tx, id);
  expectTrigger(p, "reject");
  await refuseIfLapsed(tx, p, at);
  await tx.query("UPDATE promotions SET approval_state = 'rejected', decided_by = $2, decided_at = $3, approval_comment = $4 WHERE id = $1",
    [id, user.id, at, reason]);
  await moveTo(tx, p, "rejected", "reject", user.email, at);
  await queueSnapshot(tx, id, at);
  await notify(tx, id, { kind: "rejected" }, at);
}

export async function start(tx: Tx, id: string, stage: StageRow, user: User, at: Date): Promise<void> {
  const p = await lockPromotion(tx, id);
  expectTrigger(p, "start");
  await refuseIfLapsed(tx, p, at);
  await moveTo(tx, p, "queued", "start", user.email, at);
  await leaveQueued(tx, p, stage, at);
}

export async function recheck(tx: Tx, id: string, stage: StageRow, user: User, at: Date): Promise<void> {
  const p = await lockPromotion(tx, id);
  expectTrigger(p, "recheck");
  await refuseIfLapsed(tx, p, at);
  if (!(await judgeWindow(tx, p, stage, at)).open) return;
  await moveTo(tx, p, "queued", "recheck", user.email, at);
  await enterApplying(tx, p, "window_check", SYSTEM, at);
}

export async function breakFreeze(tx: Tx, id: string, user: User, reason: string, at: Date): Promise<void> {
  const p = await lockPromotion(tx, id);
  expectTrigger(p, "break_freeze");
  await refuseIfLapsed(tx, p, at);
  await tx.query("UPDATE promotions SET freeze_break = $2 WHERE id = $1",
    [id, JSON.stringify({ by: user.email, at: at.toISOString(), reason })]);
  await moveTo(tx, p, "queued", "break_freeze", user.email, at);
  await enterApplying(tx, p, "break_freeze", user.email, at);
  await queueSnapshot(tx, id, at);
  await notify(tx, id, { kind: "freeze_broken", sre: user.name, reason }, at);
}

export interface ResourceReport { ref: string; sync: SyncValue; health: HealthValue }

/** Applies a cluster agent report: Degraded wins, then all Synced+Healthy in health_wait, else the reported phase. */
export async function applyReport(tx: Tx, p: PromotionRow, cluster: string, phase: "applying" | "health_wait",
  resources: ResourceReport[], at: Date) {
  if (p.state !== "applying" && p.state !== "health_wait") {
    throw new ApiError("promotion_not_running", `The promotion is ${p.state}, not running.`);
  }
  if (p.state === "health_wait" && phase === "applying") throw new ApiError("phase_regression", "The promotion is already in health wait.");
  const before = railOf(p.state, (await counters(tx, [p.id])).get(p.id) ?? null, null);
  for (const r of resources) {
    await tx.query("UPDATE health_rows SET sync = $3, health = $4, updated_at = $5 WHERE promotion_id = $1 AND ref = $2",
      [p.id, r.ref, r.sync, r.health, at]);
  }
  const counter = (await counters(tx, [p.id])).get(p.id) ?? { in_sync: 0, total: 0 };
  await tx.query("UPDATE promotions SET health_timeline = health_timeline || $2::jsonb WHERE id = $1",
    [p.id, JSON.stringify([{ at: at.toISOString(), phase, ...counter }])]);
  const { rows } = await tx.query<{ degraded: boolean }>(
    "SELECT bool_or(health = 'Degraded') AS degraded FROM health_rows WHERE promotion_id = $1", [p.id]);
  const actor = `agent:${cluster}`;
  if (rows[0]?.degraded) {
    await tx.query("UPDATE promotions SET failed_progress = $2 WHERE id = $1", [p.id, before.progress]);
    await moveTo(tx, p, "degraded", "report", actor, at);
    await queueSnapshot(tx, p.id, at);
  } else if (phase === "health_wait" && counter.in_sync === counter.total) {
    await tx.query("UPDATE promotions SET healthy_at = $2 WHERE id = $1", [p.id, at]);
    await moveTo(tx, p, "healthy", "report", actor, at);
    await queueSnapshot(tx, p.id, at);
  } else if (phase !== p.state) {
    await moveTo(tx, p, phase, "report", actor, at);
  }
  return { promotion_id: p.id, state: p.state, counter };
}

/** Rolls the stage back to its last healthy promotion, read back from object storage. */
export async function rollback(tx: Tx, stage: StageRow, user: User, reason: string, at: Date): Promise<string> {
  await lockStage(tx, stage);
  const current = (await currentRevisions(tx, [stage.id])).get(stage.id) ?? null;
  const { rows } = await tx.query<{ id: string; overrides: Overrides; bundle_id: string; version: string; digest: string; slug: string }>(
    `SELECT x.id, x.overrides, b.id AS bundle_id, b.version, b.digest, p.slug
       FROM promotions x JOIN bundles b ON b.id = x.bundle_id JOIN projects p ON p.id = x.project_id
      WHERE x.stage_id = $1 AND x.state = 'healthy' AND x.id IS DISTINCT FROM $2
      ORDER BY x.requested_at DESC LIMIT 1`, [stage.id, current]);
  const target = rows[0];
  if (!target) throw new ApiError("no_healthy_revision", `${stage.name} has no earlier healthy revision to roll back to.`);
  const hex = target.digest.slice("sha256:".length);
  const unreadable = "Evidence storage is unreachable, so the last healthy bundle could not be read.";
  const object = await getObject(`bundles/${target.slug}/${hex}.json`, unreadable);
  if (sha256Hex(object) !== hex) throw new ApiError("storage_unavailable", unreadable);
  // A healthy target has entered applying, so the stage has a current revision.
  const revision = await lockPromotion(tx, current as string);
  await moveTo(tx, revision, "rolled_back", "rollback", user.email, at);
  await queueSnapshot(tx, revision.id, at);
  const id = await createPromotion(tx, {
    stage, bundle: { id: target.bundle_id, version: target.version, digest: target.digest, object },
    overrides: target.overrides, requester: user, at, restores: target.id,
  });
  await tx.query("UPDATE promotions SET rollback_reason = $2 WHERE id = $1", [id, reason]);
  return id;
}
