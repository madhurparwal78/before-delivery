import type { PoolClient } from 'pg';
import { db } from './db.js';
import { ApiErrorBody, notFound, validationError } from './errors.js';
import type { BundleRef, Decision, Overrides, PersonRef, PromotionKind, PromotionState } from './domain.js';
import { instantString } from './rules.js';
import { clusterTimeString, localTimeString, windowContains } from './time.js';
import {
  bundleById, clusterWindows, currentRevisionOfStage, findCluster, findStage,
  lastHealthyPromotionExcluding, personByEmail, promotionViewById,
  releaseManagers, appendHistory, setPromotionState, releaseLockIfInactive,
  tryTakeStageLock, activePromotionOfStage, freezeVersions, newToken,
} from './store.js';
import { evidenceKey, bundleKey, getObject, putObject } from './storage.js';
import { sendMail } from './mail.js';

const APPROVAL_TTL = () => Number(process.env.KEELSON_APPROVAL_TTL_SECONDS ?? '14400');

export interface EvidenceSnapshot {
  snapshot: number;
  promotion_id: string;
  project: string;
  stage: string;
  cluster: string;
  time_zone: string;
  kind: PromotionKind;
  bundle: { version: string; digest: string; source_commit: string };
  overrides: Overrides;
  requested_by: PersonRef;
  requested_at: string;
  policy_version: number;
  state: PromotionState;
  diff: unknown[];
  approvals: { decision: string; by: string | null; at: string | null; expires_at: string | null; comment: string | null }[];
  window_decisions: unknown[];
  freeze_breaks: unknown[];
  health_timeline: unknown[];
  history: unknown[];
  restores: string | null;
}

// ------------------------------------------------------- window/freeze check

// The window check rule. The single place that decides open or closed at an
// instant, using the freeze policy version pinned on the promotion.
export async function evaluateWindowDecision(
  projectSlug: string,
  stageName: string,
  clusterId: string,
  policyVersion: number,
  at: Date,
): Promise<Decision> {
  const cluster = await findCluster(clusterId);
  if (!cluster) throw notFound();
  const versions = await freezeVersions(projectSlug);
  const version = versions.find((v) => v.version === policyVersion);
  const localTime = localTimeString(cluster.time_zone, at);
  if (version) {
    for (const freeze of version.freezes) {
      if (freeze.stages.includes(stageName)) {
        const starts = new Date(freeze.starts_at).getTime();
        const ends = new Date(freeze.ends_at).getTime();
        if (starts <= at.getTime() && at.getTime() < ends) {
          return {
            evaluated_at: instantString(at), local_time: localTime, open: false, reason: 'freeze',
            window: null, freeze: { name: freeze.name }, policy_version: policyVersion,
          };
        }
      }
    }
  }
  const windows = await clusterWindows(clusterId);
  if (windows.length === 0) {
    return {
      evaluated_at: instantString(at), local_time: localTime, open: true, reason: 'open',
      window: null, freeze: null, policy_version: policyVersion,
    };
  }
  for (const w of windows) {
    if (windowContains(cluster.time_zone, w.days, w.start, w.end, at)) {
      return {
        evaluated_at: instantString(at), local_time: localTime, open: true, reason: 'open',
        window: { id: w.id, label: w.label }, freeze: null, policy_version: policyVersion,
      };
    }
  }
  return {
    evaluated_at: instantString(at), local_time: localTime, open: false, reason: 'outside_window',
    window: null, freeze: null, policy_version: policyVersion,
  };
}

async function stageNameOf(stageId: string): Promise<string | null> {
  const r = await db.query<{ name: string }>('SELECT name FROM stages WHERE id = $1', [stageId]);
  return r.rows[0]?.name ?? null;
}

// ------------------------------------------------------- evidence snapshots

export async function buildEvidenceSnapshot(promotionId: string, snapshotNumber: number): Promise<string> {
  const promo = await promotionViewById(promotionId);
  if (!promo) throw notFound();
  const timeline = await db.query('SELECT at, phase, in_sync, total FROM health_timeline WHERE promotion_id = $1 ORDER BY seq', [promotionId]);
  const freezes = await db.query('SELECT freeze_break FROM promotions WHERE id = $1 AND freeze_break IS NOT NULL', [promotionId]);
  const snapshot: EvidenceSnapshot = {
    snapshot: snapshotNumber,
    promotion_id: promo.id,
    project: promo.project,
    stage: promo.stage,
    cluster: promo.cluster,
    time_zone: promo.time_zone,
    kind: promo.kind,
    bundle: { version: promo.bundle.version, digest: promo.bundle.digest, source_commit: promo.bundle.source_commit },
    overrides: promo.overrides,
    requested_by: promo.requested_by,
    requested_at: promo.requested_at,
    policy_version: promo.policy_version,
    state: promo.state,
    diff: promo.diff,
    approvals: [promo.approval].filter(Boolean).map((a) => ({
      decision: a!.state, by: a!.decided_by, at: a!.decided_at, expires_at: a!.expires_at, comment: a!.comment,
    })),
    window_decisions: [promo.window_decision].filter(Boolean),
    freeze_breaks: freezes.rows.map((r) => r.freeze_break),
    health_timeline: timeline.rows,
    history: promo.history,
    restores: promo.restores,
  };
  return JSON.stringify(snapshot, null, 2);
}

// Queue an evidence snapshot. If storage is up it is stored at once; otherwise
// it waits in the queue and the caller's action still succeeds.
export async function queueEvidenceSnapshot(promotionId: string, projectSlug: string): Promise<void> {
  const next = await nextSnapshotNumber(promotionId);
  const payload = await buildEvidenceSnapshot(promotionId, next);
  const key = evidenceKey(projectSlug, promotionId, next);
  try {
    await putObject(key, Buffer.from(payload));
    await db.query(
      `INSERT INTO evidence_uploads (promotion_id, project_slug, snapshot_number, object_key, payload, state)
       VALUES ($1,$2,$3,$4,$5,'stored') ON CONFLICT (promotion_id, snapshot_number) DO NOTHING`,
      [promotionId, projectSlug, next, key, payload],
    );
  } catch {
    await db.query(
      `INSERT INTO evidence_uploads (promotion_id, project_slug, snapshot_number, object_key, payload, state)
       VALUES ($1,$2,$3,$4,$5,'queued') ON CONFLICT (promotion_id, snapshot_number) DO NOTHING`,
      [promotionId, projectSlug, next, key, payload],
    );
  }
}

async function nextSnapshotNumber(promotionId: string): Promise<number> {
  const r = await db.query<{ n: string }>('SELECT count(*) AS n FROM evidence_uploads WHERE promotion_id = $1', [promotionId]);
  return Number(r.rows[0].n) + 1;
}

// Store the approval snapshot or fail. All-or-nothing: nothing is recorded
// when the upload fails.
export async function storeApprovalSnapshot(promotionId: string, projectSlug: string): Promise<void> {
  const next = await nextSnapshotNumber(promotionId);
  const payload = await buildEvidenceSnapshot(promotionId, next);
  const key = evidenceKey(projectSlug, promotionId, next);
  await putObject(key, Buffer.from(payload));
  await db.query(
    `INSERT INTO evidence_uploads (promotion_id, project_slug, snapshot_number, object_key, payload, state)
     VALUES ($1,$2,$3,$4,$5,'stored')`,
    [promotionId, projectSlug, next, key, payload],
  );
}

export async function latestStoredSnapshot(promotionId: string): Promise<{ payload: string; snapshot: number } | null> {
  const r = await db.query<{ payload: string; snapshot_number: number }>(
    `SELECT payload, snapshot_number FROM evidence_uploads
     WHERE promotion_id = $1 AND state = 'stored' ORDER BY snapshot_number DESC LIMIT 1`,
    [promotionId],
  );
  return r.rows[0] ? { payload: r.rows[0].payload, snapshot: r.rows[0].snapshot_number } : null;
}

// ------------------------------------------------------------------ notices

export interface NoticeEvent {
  project: string;
  promotionId: string;
  to: PersonRef[];
  subject: string;
  body: string;
}

export async function queueNotice(projectSlug: string, promotionId: string, to: PersonRef[], subject: string, body: string): Promise<void> {
  if (to.length === 0) return;
  try {
    await sendMail(to[0].email, subject, body);
    for (const person of to.slice(1)) {
      await db.query(
        `INSERT INTO notice_queue (promotion_id, project_slug, to_email, subject, body, state)
         VALUES ($1,$2,$3,$4,$5,'queued')`,
        [promotionId, projectSlug, person.email, subject, body],
      );
    }
  } catch {
    for (const person of to) {
      await db.query(
        `INSERT INTO notice_queue (promotion_id, project_slug, to_email, subject, body, state)
         VALUES ($1,$2,$3,$4,$5,'queued')`,
        [promotionId, projectSlug, person.email, subject, body],
      );
    }
  }
}

export async function sendOrQueueNotice(projectSlug: string, promotionId: string, toEmail: string, subject: string, body: string): Promise<void> {
  try {
    await sendMail(toEmail, subject, body);
  } catch {
    await db.query(
      `INSERT INTO notice_queue (promotion_id, project_slug, to_email, subject, body, state)
       VALUES ($1,$2,$3,$4,$5,'queued')`,
      [promotionId, projectSlug, toEmail, subject, body],
    );
  }
}

// ------------------------------------------------------------ promotions

export async function requestPromotion(
  projectSlug: string,
  stageName: string,
  requester: { email: string; name: string },
  bundleVersion: string,
  overrides: Overrides,
): Promise<{ promotionId: string; state: PromotionState; blocked: boolean; blockReason: string }> {
  const stage = await findStage(projectSlug, stageName);
  if (!stage) throw notFound();
  const bundle = await db.query<{ id: string; digest: string; version: string; source_commit: string; resources: BundleRef[] }>(
    'SELECT id, digest, version, source_commit, resources FROM bundles WHERE project_slug = $1 AND version = $2',
    [projectSlug, bundleVersion],
  );
  if (bundle.rows.length === 0) throw validationError({ bundle_version: 'Unknown bundle version.' });
  const bundleRow = bundle.rows[0];

  // Verified upstream: the bundle must have reached healthy in the upstream stage.
  if (stage.upstream_id) {
    const healthy = await db.query(
      `SELECT 1 FROM promotions WHERE bundle_id = $1 AND stage_id = $2 AND state = 'healthy' LIMIT 1`,
      [bundleRow.id, stage.upstream_id],
    );
    if (healthy.rows.length === 0) {
      throw new ApiErrorBody('not_verified_upstream', 'The bundle has not reached Healthy in the upstream stage.');
    }
  }

  // Freeze the policy version in force now.
  const versions = await freezeVersions(projectSlug);
  const now = new Date();
  const inForce = versions.reduce((best, v) => {
    const eff = new Date(v.effective_from).getTime();
    return eff <= now.getTime() && v.version > best ? v.version : best;
  }, 0);

  // Merge stage defaults with request overrides; the request wins.
  const merged = mergeOverrides(stage.defaults, overrides, bundleRow.resources);

  const requiresApproval = stage.requires_approval;
  const approvalTtlMs = APPROVAL_TTL() * 1000;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const holder = await activePromotionOfStageWithin(client, stage.id);
    if (holder) {
      await client.query('ROLLBACK');
      throw stageBusyError(holder.promotion_id, holder.bundle_version, holder.bundle_digest, holder.state);
    }
    const ins = await client.query<{ id: string }>(
      `INSERT INTO promotions (project_slug, stage_id, cluster_id, kind, state, bundle_id, overrides,
         requested_by, requested_at, policy_version, approval_state, request_expires_at, last_progress)
       VALUES ($1,$2,$3,'promotion','requested',$4,$5,$6,$7,$8,$9,$10,0.1) RETURNING id`,
      [
        projectSlug, stage.id, stage.cluster_id, bundleRow.id, JSON.stringify(merged),
        requester.email, now, inForce,
        requiresApproval ? 'pending' : 'none',
        requiresApproval ? new Date(now.getTime() + approvalTtlMs) : null,
      ],
    );
    const promoId = ins.rows[0].id;
    await appendHistory(client, promoId, null, 'requested', requester.email, now);
    await tryTakeStageLock(client, stage.id, promoId);

    let state: PromotionState = 'requested';
    if (requiresApproval) {
      state = 'awaiting_approval';
      await setPromotionState(client, promoId, 'awaiting_approval');
      await appendHistory(client, promoId, 'requested', 'awaiting_approval', 'system', now);
      // Approval link.
      await client.query('INSERT INTO approval_links (token, promotion_id) VALUES ($1,$2)', [newToken(24), promoId]);
    } else {
      state = 'queued';
      await setPromotionState(client, promoId, 'queued');
      await appendHistory(client, promoId, 'requested', 'queued', 'system', now);
      // Non-prod: run the window check at once.
      const decision = await evaluateWindowDecision(projectSlug, stage.name, stage.cluster_id, inForce, new Date());
      await client.query('UPDATE promotions SET window_decision = $2 WHERE id = $1', [promoId, JSON.stringify(decision)]);
      if (decision.open) {
        await enterApplying(client, promoId, bundleRow.resources);
        state = 'applying';
      } else {
        await setPromotionState(client, promoId, 'window_blocked');
        await appendHistory(client, promoId, 'queued', 'window_blocked', 'system', new Date());
        state = 'window_blocked';
      }
    }
    await client.query('COMMIT');
    return {
      promotionId: promoId, state, blocked: state === 'window_blocked',
      blockReason: blockReasonOf(await promotionViewById(promoId)),
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function activePromotionOfStageWithin(client: PoolClient, stageId: string) {
  const r = await client.query(
    `SELECT p.id AS promotion_id, p.state, b.version AS bundle_version, b.digest AS bundle_digest
     FROM stage_locks sl JOIN promotions p ON p.id = sl.promotion_id JOIN bundles b ON b.id = p.bundle_id
     WHERE sl.stage_id = $1`,
    [stageId],
  );
  return r.rows[0] ?? null;
}

function stageBusyError(promotionId: string, bundleVersion: string, bundleDigest: string, state: string): ApiErrorBody {
  return new ApiErrorBody('stage_busy', 'The stage already has an active promotion.', {
    holder: {
      promotion_id: promotionId,
      bundle_version: bundleVersion,
      bundle_digest: bundleDigest,
      state,
    },
  });
}

export function blockReasonOf(promo: Awaited<ReturnType<typeof promotionViewById>>): string {
  if (!promo || !promo.window_decision) return '';
  const cluster = promo.cluster;
  const zone = promo.time_zone;
  if (!promo.window_decision.open) {
    if (promo.window_decision.reason === 'freeze' && promo.window_decision.freeze) {
      return `freeze "${promo.window_decision.freeze.name}" is in force`;
    }
    return `outside the sync window for ${cluster} (${zone})`;
  }
  return '';
}

export function mergeOverrides(
  defaults: Overrides,
  request: Overrides,
  resources: BundleRef[],
): Overrides {
  const parameters: Record<string, string> = { ...defaults.parameters };
  for (const [k, v] of Object.entries(request.parameters ?? {})) parameters[k] = v;
  const replicas: Record<string, number> = {};
  const resourceRefs = new Set(resources.map((r) => r.ref));
  for (const [k, v] of Object.entries(defaults.replicas ?? {})) {
    if (resourceRefs.has(k)) replicas[k] = v;
  }
  for (const [k, v] of Object.entries(request.replicas ?? {})) replicas[k] = v;
  return { parameters, replicas };
}

export async function enterApplying(client: PoolClient, promoId: string, resources: BundleRef[]): Promise<void> {
  const at = new Date();
  await setPromotionState(client, promoId, 'applying');
  await appendHistory(client, promoId, 'queued', 'applying', 'system', at);
  await client.query('DELETE FROM health_rows WHERE promotion_id = $1', [promoId]);
  for (const r of resources) {
    await client.query(
      "INSERT INTO health_rows (promotion_id, ref, sync, health, updated_at) VALUES ($1,$2,'OutOfSync','Progressing',$3)",
      [promoId, r.ref, at],
    );
  }
}

// ---------------------------------------------------------------- approval

export async function approvePromotion(promotionId: string, approverEmail: string, comment: string | null) {
  const promo = await promotionByIdOrThrow(promotionId);
  const now = new Date();
  if (promo.state !== 'awaiting_approval') {
    throw new ApiErrorBody('invalid_transition', 'The promotion is not awaiting approval.', { state: promo.state });
  }
  if (promo.request_expires_at && now.getTime() >= promo.request_expires_at.getTime()) {
    await expirePromotion(promotionId);
    throw new ApiErrorBody('approval_expired', 'This approval request expired.');
  }
  // Evidence snapshot must be stored first (all or nothing).
  const firstSnapshot = await db.query<{ state: string }>(
    'SELECT state FROM evidence_uploads WHERE promotion_id = $1 ORDER BY snapshot_number LIMIT 1', [promotionId],
  );
  if (firstSnapshot.rows.length === 0) {
    throw new ApiErrorBody('evidence_pending', 'The evidence bundle is still being stored.');
  }
  const approvalTtlMs = APPROVAL_TTL() * 1000;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    try {
      await storeApprovalSnapshot(promotionId, promo.project_slug);
    } catch {
      throw new ApiErrorBody('storage_unavailable', 'Evidence storage is unreachable, so the approval was not recorded. Try again when it returns.');
    }
    await client.query(
      `UPDATE promotions SET state='approved', approval_state='approved', approval_decided_by=$2,
         approval_decided_at=$3, approval_expires_at=$4, approval_comment=$5 WHERE id=$1`,
      [promotionId, approverEmail, now, new Date(now.getTime() + approvalTtlMs), comment],
    );
    await appendHistory(client, promotionId, 'awaiting_approval', 'approved', approverEmail, now);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await queueEvidenceSnapshot(promotionId, promo.project_slug);
  const person = await personByEmail(promo.requested_by);
  const view = await promotionViewById(promotionId);
  if (person) {
    await sendOrQueueNotice(
      promo.project_slug, promotionId, person.email,
      `Approved: ${view!.bundle.version} to ${view!.stage}`,
      approvedBody(view!),
    );
  }
  return promotionViewById(promotionId);
}

export async function rejectPromotion(promotionId: string, rejecterEmail: string, reason: string) {
  const promo = await promotionByIdOrThrow(promotionId);
  const now = new Date();
  if (promo.state !== 'awaiting_approval') {
    throw new ApiErrorBody('invalid_transition', 'The promotion is not awaiting approval.', { state: promo.state });
  }
  if (promo.request_expires_at && now.getTime() >= promo.request_expires_at.getTime()) {
    await expirePromotion(promotionId);
    throw new ApiErrorBody('approval_expired', 'This approval request expired.');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE promotions SET state='rejected', approval_state='rejected', approval_decided_by=$2,
         approval_decided_at=$3, approval_comment=$4 WHERE id=$1`,
      [promotionId, rejecterEmail, now, reason],
    );
    await appendHistory(client, promotionId, 'awaiting_approval', 'rejected', rejecterEmail, now);
    await releaseLockIfInactive(client, promotionId);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await queueEvidenceSnapshot(promotionId, promo.project_slug);
  const person = await personByEmail(promo.requested_by);
  const view = await promotionViewById(promotionId);
  if (person) {
    await sendOrQueueNotice(
      promo.project_slug, promotionId, person.email,
      `Rejected: ${view!.bundle.version} to ${view!.stage}`,
      rejectedBody(view!, reason),
    );
  }
  return promotionViewById(promotionId);
}

async function promotionByIdOrThrow(promotionId: string) {
  const r = await db.query('SELECT * FROM promotions WHERE id = $1', [promotionId]);
  if (r.rows.length === 0) throw notFound();
  const row = r.rows[0];
  return {
    ...row,
    request_expires_at: row.request_expires_at as Date | null,
    approval_expires_at: row.approval_expires_at as Date | null,
    project_slug: row.project_slug as string,
    stage_id: row.stage_id as string,
    requested_by: row.requested_by as string,
  };
}

// ---------------------------------------------------------------- start

export async function startPromotion(promotionId: string, actorEmail: string): Promise<{ view: NonNullable<Awaited<ReturnType<typeof promotionViewById>>>; state: PromotionState }> {
  const promo = await promotionByIdOrThrow(promotionId);
  const now = new Date();
  if (promo.state === 'approved' || promo.state === 'window_blocked') {
    // Approval-lifetime guard. Rollbacks carry no approval.
    if (promo.kind === 'promotion' && promo.approval_state === 'approved') {
      if (promo.approval_expires_at && now.getTime() >= promo.approval_expires_at.getTime()) {
        await expirePromotion(promotionId);
        throw new ApiErrorBody('approval_expired', 'This approval expired. Request a new promotion.');
      }
    }
    if (promo.state === 'window_blocked') {
      // Re-run the window check.
      const decision = await evaluateWindowDecision(promo.project_slug, (await stageNameOf(promo.stage_id)) ?? '', promo.cluster_id, promo.policy_version, now);
      await db.query('UPDATE promotions SET window_decision = $2 WHERE id = $1', [promotionId, JSON.stringify(decision)]);
      if (decision.open) {
        const client = await db.connect();
        try {
          await client.query('BEGIN');
          await setPromotionState(client, promotionId, 'queued');
          await appendHistory(client, promotionId, 'window_blocked', 'queued', actorEmail, now);
          await enterApplying(client, promotionId, await bundleResourceRefs(promo.bundle_id));
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
        return { view: (await promotionViewById(promotionId))!, state: 'applying' };
      }
      return { view: (await promotionViewById(promotionId))!, state: 'window_blocked' };
    }
    // approved -> queued -> applying
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await setPromotionState(client, promotionId, 'queued');
      await appendHistory(client, promotionId, 'approved', 'queued', actorEmail, now);
      const decision = await evaluateWindowDecision(promo.project_slug, (await stageNameOf(promo.stage_id)) ?? '', promo.cluster_id, promo.policy_version, now);
      await client.query('UPDATE promotions SET window_decision = $2 WHERE id = $1', [promotionId, JSON.stringify(decision)]);
      if (decision.open) {
        await enterApplying(client, promotionId, await bundleResourceRefs(promo.bundle_id));
      } else {
        await setPromotionState(client, promotionId, 'window_blocked');
        await appendHistory(client, promotionId, 'queued', 'window_blocked', 'system', now);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const fresh = await promotionByIdOrThrow(promotionId);
    return { view: (await promotionViewById(promotionId))!, state: fresh.state as PromotionState };
  }
  throw new ApiErrorBody('invalid_transition', 'The promotion cannot start from its current state.', { state: promo.state as PromotionState });
}

export async function retryWindow(promotionId: string, actorEmail: string) {
  return startPromotion(promotionId, actorEmail);
}

export async function breakFreeze(promotionId: string, actorEmail: string, reason: string) {
  const promo = await promotionByIdOrThrow(promotionId);
  const now = new Date();
  if (promo.state !== 'window_blocked') {
    throw new ApiErrorBody('invalid_transition', 'The promotion is not blocked by a window.', { state: promo.state as PromotionState });
  }
  if (promo.kind === 'promotion' && promo.approval_state === 'approved') {
    if (promo.approval_expires_at && now.getTime() >= promo.approval_expires_at.getTime()) {
      await expirePromotion(promotionId);
      throw new ApiErrorBody('approval_expired', 'This approval expired. Request a new promotion.');
    }
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE promotions SET freeze_break = $2 WHERE id = $1',
      [promotionId, JSON.stringify({ by: actorEmail, at: instantString(now), reason })],
    );
    await setPromotionState(client, promotionId, 'queued');
    await appendHistory(client, promotionId, 'window_blocked', 'queued', actorEmail, now);
    await enterApplying(client, promotionId, await bundleResourceRefs(promo.bundle_id));
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await queueEvidenceSnapshot(promotionId, promo.project_slug);
  const view = await promotionViewById(promotionId);
  const sre = await personByEmail(actorEmail);
  const managers = await releaseManagers(promo.project_slug);
  for (const m of managers) {
    await sendOrQueueNotice(
      promo.project_slug, promotionId, m.email,
      `Freeze broken: ${view!.stage} by ${sre?.name ?? actorEmail}`,
      freezeBrokenBody(view!, sre?.name ?? actorEmail, reason),
    );
  }
  return view;
}

async function bundleResourceRefs(bundleId: string): Promise<BundleRef[]> {
  const r = await db.query<{ resources: BundleRef[] }>('SELECT resources FROM bundles WHERE id = $1', [bundleId]);
  return r.rows[0].resources;
}

// ---------------------------------------------------------------- rollback

export async function rollbackStage(
  projectSlug: string,
  stageName: string,
  actorEmail: string,
  reason: string,
) {
  const stage = await findStage(projectSlug, stageName);
  if (!stage) throw notFound();
  const active = await activePromotionOfStage(stage.id);
  if (active) {
    const bundle = await bundleById(active.bundle_id);
    throw stageBusyError(active.id, bundle?.version ?? '', bundle?.digest ?? '', active.state);
  }
  const current = await currentRevisionOfStage(stage.id);
  const target = current
    ? await lastHealthyPromotionExcluding(stage.id, current.id)
    : await lastHealthyPromotionExcluding(stage.id, null);
  if (!target) {
    throw new ApiErrorBody('no_healthy_revision', 'The stage has no earlier healthy revision to roll back to.');
  }
  // Read the target bundle back from object storage and verify the digest.
  const targetBundle = await bundleById(target.bundle_id);
  if (!targetBundle) throw notFound();
  const digestHex = targetBundle.digest.replace(/^sha256:/, '');
  let objectBytes: Buffer;
  try {
    objectBytes = Buffer.from(await getObject(bundleKey(projectSlug, digestHex)));
  } catch {
    throw new ApiErrorBody('storage_unavailable', 'Evidence storage is unreachable, so the rollback could not read the last healthy bundle.');
  }
  const actual = `sha256:${cryptoCreateHash(objectBytes)}`;
  if (actual !== targetBundle.digest) {
    throw new ApiErrorBody('no_healthy_revision', 'The stored bundle does not match its digest.');
  }
  const versions = await freezeVersions(projectSlug);
  const now = new Date();
  const inForce = versions.reduce((best, v) => {
    const eff = new Date(v.effective_from).getTime();
    return eff <= now.getTime() && v.version > best ? v.version : best;
  }, 0);
  const resources = await bundleResourceRefs(target.bundle_id);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (current) {
      await setPromotionState(client, current.id, 'rolled_back');
      await appendHistory(client, current.id, current.state, 'rolled_back', actorEmail, now);
      await releaseLockIfInactive(client, current.id);
    }
    const ins = await client.query<{ id: string }>(
      `INSERT INTO promotions (project_slug, stage_id, cluster_id, kind, state, bundle_id, overrides,
         requested_by, requested_at, policy_version, approval_state, request_expires_at, restores, approval_comment, last_progress)
       VALUES ($1,$2,$3,'rollback','requested',$4,$5,$6,$7,$8,'none',NULL,$9,$10,0.1) RETURNING id`,
      [projectSlug, stage.id, stage.cluster_id, target.bundle_id, JSON.stringify(target.overrides),
       actorEmail, now, inForce, target.id, reason],
    );
    const promoId = ins.rows[0].id;
    await appendHistory(client, promoId, null, 'requested', actorEmail, now);
    await tryTakeStageLock(client, stage.id, promoId);
    await setPromotionState(client, promoId, 'queued');
    await appendHistory(client, promoId, 'requested', 'queued', 'system', now);
    const decision = await evaluateWindowDecision(projectSlug, stage.name, stage.cluster_id, inForce, new Date());
    await client.query('UPDATE promotions SET window_decision = $2 WHERE id = $1', [promoId, JSON.stringify(decision)]);
    if (decision.open) {
      await enterApplying(client, promoId, resources);
    } else {
      await setPromotionState(client, promoId, 'window_blocked');
      await appendHistory(client, promoId, 'queued', 'window_blocked', 'system', new Date());
    }
    await client.query('COMMIT');
    await queueEvidenceSnapshot(promoId, projectSlug);
    return promotionViewById(promoId);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

import crypto from 'node:crypto';
function cryptoCreateHash(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// ------------------------------------------------------------- expiry sweep

// The approval expiry rule. The single place that expires lapsed requests and
// approvals, sending exactly one expiry notice for each promotion.
export async function expirySweep(): Promise<void> {
  const now = new Date();
  // Requests lapsed.
  const lapsedRequests = await db.query<{ id: string; project_slug: string; requested_by: string }>(
    `SELECT id, project_slug, requested_by FROM promotions
     WHERE state = 'awaiting_approval' AND request_expires_at IS NOT NULL AND request_expires_at <= $1`,
    [now],
  );
  for (const row of lapsedRequests.rows) {
    await expirePromotion(row.id);
  }
  // Approvals lapsed (prod promotions of kind promotion only).
  const lapsedApprovals = await db.query<{ id: string }>(
    `SELECT id FROM promotions
     WHERE kind = 'promotion' AND approval_state = 'approved'
       AND state IN ('approved','window_blocked')
       AND approval_expires_at IS NOT NULL AND approval_expires_at <= $1`,
    [now],
  );
  for (const row of lapsedApprovals.rows) {
    await expirePromotion(row.id);
  }
}

async function expirePromotion(promotionId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ state: PromotionState; requested_by: string; project_slug: string }>(
      'SELECT state, requested_by, project_slug FROM promotions WHERE id = $1 FOR UPDATE',
      [promotionId],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }
    const promo = r.rows[0];
    if (promo.state === 'awaiting_approval' || promo.state === 'approved' || promo.state === 'window_blocked') {
      await setPromotionState(client, promotionId, 'expired');
      await appendHistory(client, promotionId, promo.state, 'expired', 'system', new Date());
      await client.query("UPDATE promotions SET approval_state='expired' WHERE id=$1", [promotionId]);
      await releaseLockIfInactive(client, promotionId);
      await client.query('COMMIT');
      await queueEvidenceSnapshot(promotionId, promo.project_slug);
      const view = await promotionViewById(promotionId);
      await sendOrQueueNotice(
        promo.project_slug, promotionId, promo.requested_by,
        `Approval expired: ${view!.bundle.version} to ${view!.stage}`,
        expiredBody(view!),
      );
    } else {
      await client.query('ROLLBACK');
    }
  } catch {
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------ agent reports

export interface AgentReportInput {
  promotion_id: string;
  phase: 'applying' | 'health_wait';
  resources: { ref: string; sync: 'Synced' | 'OutOfSync'; health: 'Healthy' | 'Progressing' | 'Degraded' | 'Missing' }[];
}

export async function agentReport(input: AgentReportInput, clusterName: string) {
  const promo = await promotionByIdOrThrow(input.promotion_id);
  const cluster = await findCluster(promo.cluster_id);
  if (!cluster || cluster.name !== clusterName) throw notFound();
  if (promo.state !== 'applying' && promo.state !== 'health_wait') {
    throw new ApiErrorBody('promotion_not_running', 'The promotion is not running.', { state: promo.state as PromotionState });
  }
  if (promo.state === 'health_wait' && input.phase === 'applying') {
    throw new ApiErrorBody('phase_regression', 'The promotion has already passed the applying phase.', { state: promo.state as PromotionState });
  }
  // Validate the refs.
  const rows = await db.query<{ ref: string }>('SELECT ref FROM health_rows WHERE promotion_id = $1', [input.promotion_id]);
  const known = new Set(rows.rows.map((r) => r.ref));
  for (const r of input.resources) {
    if (!known.has(r.ref)) throw validationError({ resources: `Unknown resource ${r.ref}.` });
  }
  const now = new Date();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of input.resources) {
      await client.query(
        'UPDATE health_rows SET sync=$3, health=$4, updated_at=$5 WHERE promotion_id=$1 AND ref=$2',
        [input.promotion_id, r.ref, r.sync, r.health, now],
      );
    }
    // Compute the counter after the updates.
    const counter = await counterWithin(client, input.promotion_id);
    await client.query(
      'INSERT INTO health_timeline (promotion_id, phase, in_sync, total) VALUES ($1,$2,$3,$4)',
      [input.promotion_id, input.phase, counter.in_sync, counter.total],
    );
    let nextState: PromotionState = promo.state;
    const anyDegraded = input.resources.some((r) => r.health === 'Degraded');
    if (anyDegraded) {
      nextState = 'degraded';
      const current = await counterAllWithin(client, input.promotion_id);
      const failedProgress = promo.state === 'applying'
        ? 0.2 + 0.4 * (current.in_sync / current.total)
        : 0.6 + 0.35 * (current.in_sync / current.total);
      await client.query('UPDATE promotions SET failed_progress = $2 WHERE id = $1', [input.promotion_id, failedProgress]);
    } else if (input.phase === 'health_wait' && counter.in_sync === counter.total) {
      nextState = 'healthy';
    } else {
      nextState = input.phase === 'health_wait' ? 'health_wait' : 'applying';
    }
    if (nextState !== promo.state) {
      await setPromotionState(client, input.promotion_id, nextState);
      await appendHistory(client, input.promotion_id, promo.state, nextState, `agent:${clusterName}`, now);
      if (nextState === 'healthy' || nextState === 'degraded') {
        await releaseLockIfInactive(client, input.promotion_id);
      }
    }
    await client.query('COMMIT');
    await queueEvidenceSnapshot(input.promotion_id, promo.project_slug);
    return { state: nextState, counter };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function counterWithin(client: PoolClient, promotionId: string) {
  const r = await client.query<{ synced: string; total: string }>(
    `SELECT count(*) FILTER (WHERE sync='Synced' AND health='Healthy') AS synced, count(*) AS total
     FROM health_rows WHERE promotion_id = $1`,
    [promotionId],
  );
  return { in_sync: Number(r.rows[0].synced), total: Number(r.rows[0].total) };
}

async function counterAllWithin(client: PoolClient, promotionId: string) {
  return counterWithin(client, promotionId);
}

// ------------------------------------------------------------- mail bodies

function approvedBody(view: NonNullable<Awaited<ReturnType<typeof promotionViewById>>>): string {
  return `Hello,

Your promotion of ${view.bundle.version} (${view.bundle.short_digest}) to ${view.stage} in ${view.project} was approved.

The approval expires at ${view.approval?.expires_at ?? ''}.
Open it in Keelson: ${publicUrl()}/projects/${view.project}
`;
}

function rejectedBody(view: NonNullable<Awaited<ReturnType<typeof promotionViewById>>>, reason: string): string {
  return `Hello,

Your promotion of ${view.bundle.version} (${view.bundle.short_digest}) to ${view.stage} in ${view.project} was rejected.

Reason: ${reason}
Open it in Keelson: ${publicUrl()}/projects/${view.project}
`;
}

export function approvalRequestedBody(
  view: NonNullable<Awaited<ReturnType<typeof promotionViewById>>>,
  link: string,
): string {
  const diffLines = view.diff.map((d) => {
    const path = d.path ? ` ${d.path}` : '';
    return `- ${d.resource}${path}: ${d.change}`;
  }).join('\n');
  const clusterExpiry = view.approval
    ? clusterTimeString(view.time_zone, new Date(view.approval.request_expires_at))
    : '';
  return `Hello,

A promotion of ${view.bundle.version} (${view.bundle.short_digest}) to ${view.stage} in ${view.project} awaits your approval.

Requested by ${view.requested_by.name} <${view.requested_by.email}>.
The request expires at ${clusterExpiry}.

Diff summary (secret values redacted):
${diffLines || '- no changes'}

Review and approve: ${link}
Open in Keelson: ${publicUrl()}/projects/${view.project}
`;
}

function expiredBody(view: NonNullable<Awaited<ReturnType<typeof promotionViewById>>>): string {
  return `Hello,

The approval for the promotion of ${view.bundle.version} (${view.bundle.short_digest}) to ${view.stage} in ${view.project} expired.

Requested by ${view.requested_by.name} <${view.requested_by.email}>.
Open it in Keelson: ${publicUrl()}/projects/${view.project}
`;
}

function freezeBrokenBody(
  view: NonNullable<Awaited<ReturnType<typeof promotionViewById>>>,
  sreName: string,
  reason: string,
): string {
  return `Hello,

${sreName} broke a freeze on ${view.stage} in ${view.project} to apply ${view.bundle.version} (${view.bundle.short_digest}).

Reason: ${reason}
Open it in Keelson: ${publicUrl()}/projects/${view.project}
`;
}

export function publicUrl(): string {
  const port = process.env.APP_PUBLIC_PORT ?? '4173';
  return process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`;
}
