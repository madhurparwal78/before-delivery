import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  Freeze,
  Overrides,
  Promotion,
  PromotionCounter,
  PromotionState,
  ResourceHealth,
  ResourceSync,
  WindowDecision,
} from '../shared/types.js';
import { isUniqueViolation, queryOne, runner, transaction, type Tx } from './db.js';
import { approvalExpiresAt, isLapsed, requestExpiresAt } from './domain/approval.js';
import { inSyncCounter } from './domain/counter.js';
import { buildDiff } from './domain/diff.js';
import { versionInForce } from './domain/freeze-policy.js';
import { railPosition } from './domain/rail.js';
import { isLegalTransition } from './domain/transitions.js';
import { decideWindow } from './domain/window-check.js';
import { ApiError, errors, fieldMessages } from './errors.js';
import { bundleKey, writeSnapshot, writeSnapshotBeforeDecision } from './evidence.js';
import {
  queueApprovalRequested,
  queueApproved,
  queueExpired,
  queueFreezeBroken,
  queueRejected,
} from './notices.js';
import {
  PROMOTION_SELECT,
  activePromotionRow,
  buildPromotion,
  currentRevisionRow,
  findBundleById,
  findStageById,
  healthRows,
  listFreezeVersions,
  listWindows,
  lockPromotion,
  promotionCounter,
  type BundleRow,
  type PersonRow,
  type ProjectRow,
  type PromotionRow,
  type StageRow,
} from './repo.js';
import { firstSnapshotStored } from './services/queues.js';
import { StorageUnreachable, getObject } from './services/storage.js';

const STAGE_LOCK_CONSTRAINT = 'promotions_one_active_per_stage';

function reload(tx: Tx, promotionId: string): Promise<PromotionRow> {
  return lockPromotion(tx, promotionId).then((row) => {
    if (!row) throw new Error(`Promotion ${promotionId} vanished inside its own transaction`);
    return row;
  });
}

/**
 * The single gate on promotion state. Nothing else writes `promotions.state`, so every change
 * is checked against the transition table and appends exactly one history entry.
 */
async function transitionTo(
  tx: Tx,
  row: PromotionRow,
  to: PromotionState,
  actor: string,
  at: Date,
): Promise<PromotionRow> {
  if (!isLegalTransition(row.state, to)) throw errors.invalidTransition(row.state);
  await tx.query('UPDATE promotions SET state = $2 WHERE id = $1', [row.id, to]);
  await tx.query(
    `INSERT INTO promotion_history (promotion_id, from_state, to_state, at, actor)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.state, to, at, actor],
  );
  return reload(tx, row.id);
}

async function pinnedFreezes(tx: Tx, projectId: string, policyVersion: number): Promise<Freeze[]> {
  const row = await tx.queryOne<{ freezes: Freeze[] }>(
    'SELECT freezes FROM freeze_policy_versions WHERE project_id = $1 AND version = $2',
    [projectId, policyVersion],
  );
  return row?.freezes ?? [];
}

/** Runs the pinned policy's window check for a promotion and records the decision. */
async function runWindowCheck(tx: Tx, row: PromotionRow, at: Date): Promise<WindowDecision> {
  const stage = await findStageById(row.stage_id, tx);
  if (!stage) throw new Error(`Stage ${row.stage_id} is missing`);
  const decision = decideWindow({
    instant: at,
    timeZone: stage.time_zone,
    stage: stage.name,
    windows: await listWindows(stage.cluster_id, tx),
    freezes: await pinnedFreezes(tx, row.project_id, row.policy_version),
    policyVersion: row.policy_version,
  });
  await tx.query(
    'INSERT INTO window_decisions (promotion_id, decision, created_at) VALUES ($1, $2, $3)',
    [row.id, decision, at],
  );
  return decision;
}

/** Opens the promotion's health rows and makes it the stage's current revision. */
async function enterApplying(tx: Tx, row: PromotionRow, at: Date, actor: string): Promise<PromotionRow> {
  const bundle = await findBundleById(row.bundle_id, tx);
  if (!bundle) throw new Error(`Bundle ${row.bundle_id} is missing`);
  for (const [position, resource] of bundle.resources.entries()) {
    await tx.query(
      `INSERT INTO health_rows
         (promotion_id, ref, kind, namespace, name, sync, health, updated_at, position)
       VALUES ($1, $2, $3, $4, $5, 'OutOfSync', 'Progressing', $6, $7)`,
      [row.id, resource.ref, resource.kind, resource.namespace, resource.name, at, position],
    );
  }
  await tx.query('UPDATE promotions SET entered_applying_at = $2 WHERE id = $1', [row.id, at]);
  return transitionTo(tx, row, 'applying', actor, at);
}

/** Leaves `queued` through the window check: open means applying, closed means window_blocked. */
async function leaveQueued(tx: Tx, row: PromotionRow, at: Date, actor: string): Promise<PromotionRow> {
  const decision = await runWindowCheck(tx, row, at);
  return decision.open
    ? enterApplying(tx, row, at, actor)
    : transitionTo(tx, row, 'window_blocked', actor, at);
}

/** "Verified upstream" means the bundle has at some point reached healthy in that stage. */
async function hasReachedHealthy(stageId: string, bundleId: string, tx?: Tx): Promise<boolean> {
  const row = await runner(tx).queryOne<{ ok: boolean }>(
    `SELECT true AS ok FROM promotions p
     JOIN promotion_history h ON h.promotion_id = p.id
     WHERE p.stage_id = $1 AND p.bundle_id = $2 AND h.to_state = 'healthy' LIMIT 1`,
    [stageId, bundleId],
  );
  return row !== null;
}

/**
 * Merges stage defaults with the request's overrides, the request winning on equal keys, and
 * drops default replica refs the bundle does not carry. The result is frozen on the promotion.
 */
function freezeOverrides(defaults: Overrides, requested: Overrides, bundle: BundleRow): Overrides {
  const refs = new Set(bundle.resources.map((resource) => resource.ref));
  const replicas: Record<string, number> = {};
  for (const [ref, count] of Object.entries(defaults.replicas)) {
    if (refs.has(ref)) replicas[ref] = count;
  }
  return {
    parameters: { ...defaults.parameters, ...requested.parameters },
    replicas: { ...replicas, ...requested.replicas },
  };
}

async function currentSide(
  tx: Tx,
  stageId: string,
): Promise<{ manifests: Record<string, unknown>[]; overrides: Overrides } | null> {
  const current = await currentRevisionRow(stageId, tx);
  if (!current) return null;
  const bundle = await findBundleById(current.bundle_id, tx);
  if (!bundle) return null;
  return { manifests: bundle.manifests, overrides: current.overrides };
}

export interface NewPromotion {
  project: ProjectRow;
  stage: StageRow;
  bundle: BundleRow;
  overrides: Overrides;
  requester: PersonRow;
  kind: 'promotion' | 'rollback';
  restores: string | null;
  frozenOverrides: Overrides | null;
  /** A rollback supersedes the stage's current revision inside the same transaction. */
  supersede: string | null;
}

async function insertAndAdvance(input: NewPromotion): Promise<PromotionRow> {
  const { project, stage, bundle, requester } = input;
  const promotionId = randomUUID();

  return transaction(async (tx) => {
    const at = new Date();
    if (input.supersede) {
      const superseded = await reload(tx, input.supersede);
      if (superseded.state === 'healthy' || superseded.state === 'degraded') {
        const rolledBack = await transitionTo(tx, superseded, 'rolled_back', requester.email, at);
        await writeSnapshot(tx, rolledBack);
      }
    }
    const policy = versionInForce(await listFreezeVersions(project.id, tx), at);
    const overrides =
      input.frozenOverrides ?? freezeOverrides(stage.defaults, input.overrides, bundle);
    const diff = buildDiff(await currentSide(tx, stage.id), { manifests: bundle.manifests, overrides });
    const needsApproval = input.kind === 'promotion' && stage.requires_approval;

    await tx.query(
      `INSERT INTO promotions
         (id, project_id, stage_id, bundle_id, kind, state, overrides, diff, requested_by,
          requested_at, policy_version, approval_required, approval_state, request_expires_at,
          restores_promotion_id)
       VALUES ($1, $2, $3, $4, $5, 'requested', $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        promotionId,
        project.id,
        stage.id,
        bundle.id,
        input.kind,
        overrides,
        JSON.stringify(diff),
        requester.id,
        at,
        policy.version,
        needsApproval,
        needsApproval ? 'pending' : null,
        needsApproval ? requestExpiresAt(at) : null,
        input.restores,
      ],
    );
    await tx.query(
      `INSERT INTO promotion_history (promotion_id, from_state, to_state, at, actor)
       VALUES ($1, NULL, 'requested', $2, $3)`,
      [promotionId, at, requester.email],
    );

    let row = await reload(tx, promotionId);
    if (needsApproval) {
      row = await transitionTo(tx, row, 'awaiting_approval', 'system', at);
      const token = randomBytes(24).toString('base64url');
      await tx.query(
        'INSERT INTO approval_links (token_hash, promotion_id, created_at) VALUES ($1, $2, now())',
        [hashToken(token), promotionId],
      );
      await writeSnapshot(tx, row);
      await queueApprovalRequested(tx, row, token);
      return row;
    }

    row = await transitionTo(tx, row, 'queued', 'system', at);
    row = await leaveQueued(tx, row, at, 'system');
    await writeSnapshot(tx, row);
    return row;
  });
}

function stageBusy(holder: PromotionRow): ApiError {
  return errors.stageBusy({
    promotion_id: holder.id,
    bundle_version: holder.bundle_version,
    bundle_digest: holder.bundle_digest,
    state: holder.state,
  });
}

/**
 * Of simultaneous requests to one stage exactly one wins, because the partial unique index over
 * the active states lets Postgres pick the winner across every running instance.
 */
async function withStageLock(stage: StageRow, run: () => Promise<PromotionRow>): Promise<PromotionRow> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (cause) {
      if (!isUniqueViolation(cause, STAGE_LOCK_CONSTRAINT)) throw cause;
      const holder = await activePromotionRow(stage.id);
      if (holder) throw stageBusy(holder);
      if (attempt === 2) throw cause;
    }
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function requestPromotion(input: {
  project: ProjectRow;
  stage: StageRow;
  bundle: BundleRow;
  overrides: Overrides;
  requester: PersonRow;
}): Promise<Promotion> {
  if (input.stage.upstream_stage_id) {
    const verified = await hasReachedHealthy(input.stage.upstream_stage_id, input.bundle.id);
    if (!verified) {
      throw errors.notVerifiedUpstream(input.bundle.version, input.stage.upstream_name ?? 'upstream');
    }
  }
  const row = await withStageLock(input.stage, () =>
    insertAndAdvance({
      ...input,
      kind: 'promotion',
      restores: null,
      frozenOverrides: null,
      supersede: null,
    }),
  );
  return buildPromotion(row);
}

/** Marks a lapsed promotion expired, with exactly one expiry notice to the requester. */
async function expirePromotion(promotionId: string): Promise<void> {
  await transaction(async (tx) => {
    const row = await lockPromotion(tx, promotionId);
    if (!row) return;
    const at = new Date();
    if (
      !isLapsed(
        {
          kind: row.kind,
          state: row.state,
          requestExpiresAt: row.request_expires_at,
          approvalExpiresAt: row.approval_expires_at,
        },
        at,
      )
    ) {
      return;
    }
    await tx.query(`UPDATE promotions SET approval_state = 'expired' WHERE id = $1`, [row.id]);
    const expired = await transitionTo(tx, row, 'expired', 'system', at);
    await writeSnapshot(tx, expired);
    await queueExpired(tx, expired);
  });
}

async function refuseIfLapsed(row: PromotionRow): Promise<void> {
  const lapsed = isLapsed(
    {
      kind: row.kind,
      state: row.state,
      requestExpiresAt: row.request_expires_at,
      approvalExpiresAt: row.approval_expires_at,
    },
    new Date(),
  );
  if (!lapsed) return;
  await expirePromotion(row.id);
  throw errors.approvalExpired();
}

/**
 * A promotion only ever reaches `expired` by its approval lapsing, so a caller who arrives late
 * is told that rather than being given the generic transition refusal.
 */
function requireState(row: PromotionRow, expected: PromotionState): void {
  if (row.state === expected) return;
  if (row.state === 'expired') throw errors.approvalExpired();
  throw errors.invalidTransition(row.state);
}

export async function approvePromotion(
  row: PromotionRow,
  actor: PersonRow,
  comment: string | null,
): Promise<Promotion> {
  requireState(row, 'awaiting_approval');
  await refuseIfLapsed(row);

  const updated = await transaction(async (tx) => {
    const locked = await reload(tx, row.id);
    requireState(locked, 'awaiting_approval');
    if (!(await firstSnapshotStored(tx, locked.id))) throw errors.evidencePending();

    const at = new Date();
    await tx.query(
      `UPDATE promotions SET approval_state = 'approved', approval_decided_by = $2,
         approval_decided_at = $3, approval_expires_at = $4, approval_comment = $5
       WHERE id = $1`,
      [locked.id, actor.email, at, approvalExpiresAt(at), comment],
    );
    const approved = await transitionTo(tx, locked, 'approved', actor.email, at);
    await writeSnapshotBeforeDecision(tx, approved);
    await queueApproved(tx, approved);
    return approved;
  }).catch((cause: unknown) => {
    if (cause instanceof StorageUnreachable) throw errors.storageUnavailable();
    throw cause;
  });

  return buildPromotion(updated);
}

export async function rejectPromotion(
  row: PromotionRow,
  actor: PersonRow,
  reason: string,
): Promise<Promotion> {
  requireState(row, 'awaiting_approval');
  await refuseIfLapsed(row);

  const updated = await transaction(async (tx) => {
    const locked = await reload(tx, row.id);
    requireState(locked, 'awaiting_approval');
    const at = new Date();
    await tx.query(
      `UPDATE promotions SET approval_state = 'rejected', approval_decided_by = $2,
         approval_decided_at = $3, approval_comment = $4
       WHERE id = $1`,
      [locked.id, actor.email, at, reason],
    );
    const rejected = await transitionTo(tx, locked, 'rejected', actor.email, at);
    await writeSnapshot(tx, rejected);
    await queueRejected(tx, rejected);
    return rejected;
  });

  return buildPromotion(updated);
}

export async function startPromotion(row: PromotionRow, actor: PersonRow): Promise<Promotion> {
  requireState(row, 'approved');
  await refuseIfLapsed(row);

  const updated = await transaction(async (tx) => {
    const locked = await reload(tx, row.id);
    requireState(locked, 'approved');
    const at = new Date();
    const queued = await transitionTo(tx, locked, 'queued', actor.email, at);
    return leaveQueued(tx, queued, at, actor.email);
  });

  return buildPromotion(updated);
}

export async function retryWindow(row: PromotionRow, actor: PersonRow): Promise<Promotion> {
  requireState(row, 'window_blocked');
  await refuseIfLapsed(row);

  const updated = await transaction(async (tx) => {
    const locked = await reload(tx, row.id);
    requireState(locked, 'window_blocked');
    const at = new Date();
    const decision = await runWindowCheck(tx, locked, at);
    if (!decision.open) return reload(tx, locked.id);
    const queued = await transitionTo(tx, locked, 'queued', actor.email, at);
    return enterApplying(tx, queued, at, actor.email);
  });

  return buildPromotion(updated);
}

export async function breakFreeze(
  row: PromotionRow,
  actor: PersonRow,
  reason: string,
): Promise<Promotion> {
  requireState(row, 'window_blocked');
  await refuseIfLapsed(row);

  const updated = await transaction(async (tx) => {
    const locked = await reload(tx, row.id);
    requireState(locked, 'window_blocked');
    const at = new Date();
    await tx.query('UPDATE promotions SET freeze_break = $2 WHERE id = $1', [
      locked.id,
      { by: actor.email, at: at.toISOString(), reason },
    ]);
    const withBreak = await reload(tx, locked.id);
    const queued = await transitionTo(tx, withBreak, 'queued', actor.email, at);
    const applying = await enterApplying(tx, queued, at, actor.email);
    await writeSnapshot(tx, applying);
    await queueFreezeBroken(tx, applying, actor.name);
    return applying;
  });

  return buildPromotion(updated);
}

/**
 * Starts a new promotion carrying the exact bundle digest and stored override set of the
 * stage's last healthy promotion, read back from object storage and checked against its digest.
 */
export async function rollbackStage(input: {
  project: ProjectRow;
  stage: StageRow;
  actor: PersonRow;
}): Promise<Promotion> {
  const { project, stage, actor } = input;
  const active = await activePromotionRow(stage.id);
  if (active) throw stageBusy(active);

  const current = await currentRevisionRow(stage.id);
  const target = await findLastHealthy(stage.id, current?.id ?? null);
  if (!target) throw errors.noHealthyRevision(stage.name);

  const bundle = await findBundleById(target.bundle_id);
  if (!bundle) throw new Error(`Bundle ${target.bundle_id} is missing`);
  await readBackBundle(project.slug, bundle);

  const row = await withStageLock(stage, () =>
    insertAndAdvance({
      project,
      stage,
      bundle,
      overrides: target.overrides,
      frozenOverrides: target.overrides,
      requester: actor,
      kind: 'rollback',
      restores: target.id,
      supersede: current?.id ?? null,
    }),
  );

  return buildPromotion(row);
}

/** The rollback target: the stage's most recent healthy promotion, bar the current revision. */
async function findLastHealthy(stageId: string, excludeId: string | null): Promise<PromotionRow | null> {
  return queryOne<PromotionRow>(
    `${PROMOTION_SELECT}
     WHERE p.stage_id = $1 AND p.state = 'healthy' AND ($2::uuid IS NULL OR p.id <> $2)
     ORDER BY p.entered_applying_at DESC NULLS LAST, p.seq DESC LIMIT 1`,
    [stageId, excludeId],
  );
}

async function readBackBundle(projectSlug: string, bundle: BundleRow): Promise<void> {
  let stored: Buffer | null;
  try {
    stored = await getObject(bundleKey(projectSlug, bundle.digest));
  } catch (cause) {
    if (cause instanceof StorageUnreachable) throw errors.storageUnavailable();
    throw cause;
  }
  if (!stored) throw errors.storageUnavailable();
  const digest = `sha256:${createHash('sha256').update(stored).digest('hex')}`;
  if (digest !== bundle.digest) throw errors.storageUnavailable();
}

export interface AgentReport {
  promotionId: string;
  phase: 'applying' | 'health_wait';
  resources: { ref: string; sync: ResourceSync; health: ResourceHealth }[];
}

export interface AgentReportResult {
  promotion_id: string;
  state: PromotionState;
  counter: PromotionCounter;
}

/**
 * Applies the cluster agent's per-resource report: a Degraded row fails the promotion, a
 * health_wait report with every row Synced and Healthy finishes it, otherwise it follows the
 * reported phase.
 */
export async function applyAgentReport(report: AgentReport): Promise<AgentReportResult> {
  return transaction(async (tx) => {
    const locked = await reload(tx, report.promotionId);
    if (locked.state !== 'applying' && locked.state !== 'health_wait') {
      throw errors.promotionNotRunning();
    }
    if (report.phase === 'applying' && locked.state === 'health_wait') {
      throw errors.phaseRegression();
    }

    const known = new Set((await healthRows(locked.id, tx)).map((row) => row.ref));
    for (const resource of report.resources) {
      if (!known.has(resource.ref)) {
        throw errors.validation({ resources: fieldMessages.unknownResource(resource.ref) });
      }
    }

    const before = railPosition(locked.state, await promotionCounter(locked, tx), null).progress;
    const at = new Date();
    for (const resource of report.resources) {
      await tx.query(
        `UPDATE health_rows SET sync = $3, health = $4, updated_at = $5
         WHERE promotion_id = $1 AND ref = $2`,
        [locked.id, resource.ref, resource.sync, resource.health, at],
      );
    }

    const rows = await healthRows(locked.id, tx);
    const counter = inSyncCounter(rows);
    await tx.query(
      `INSERT INTO health_timeline (promotion_id, at, phase, in_sync, total)
       VALUES ($1, $2, $3, $4, $5)`,
      [locked.id, at, report.phase, counter.in_sync, counter.total],
    );

    const actor = `agent:${locked.cluster_name}`;
    const degraded = rows.some((row) => row.health === 'Degraded');
    const allHealthy = rows.every((row) => row.sync === 'Synced' && row.health === 'Healthy');

    let next = locked;
    if (degraded) {
      const atFailure = Math.max(before, railPosition(report.phase, counter, null).progress);
      await tx.query('UPDATE promotions SET degraded_progress = $2 WHERE id = $1', [locked.id, atFailure]);
      next = await transitionTo(tx, await reload(tx, locked.id), 'degraded', actor, at);
      await writeSnapshot(tx, next);
    } else if (report.phase === 'health_wait' && allHealthy) {
      if (locked.state === 'applying') {
        next = await transitionTo(tx, locked, 'health_wait', actor, at);
      }
      next = await transitionTo(tx, next, 'healthy', actor, at);
      await writeSnapshot(tx, next);
    } else if (report.phase !== locked.state) {
      next = await transitionTo(tx, locked, report.phase, actor, at);
    }

    return { promotion_id: next.id, state: next.state, counter };
  });
}

/** Expires every lapsed request and approval. Runs on a timer and before any decision. */
async function sweepExpiries(): Promise<void> {
  const lapsed = await transaction((tx) =>
    tx.query<{ id: string }>(
      `SELECT id FROM promotions
       WHERE kind = 'promotion' AND (
         (state = 'awaiting_approval' AND request_expires_at <= now()) OR
         (state IN ('approved', 'window_blocked') AND approval_expires_at <= now()))`,
    ),
  );
  for (const row of lapsed) await expirePromotion(row.id);
}

export function startExpirySweeper(intervalMs = 2000): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await sweepExpiries();
    } catch (cause) {
      process.stderr.write(`expiry sweep: ${String(cause)}\n`);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs).unref();
}
