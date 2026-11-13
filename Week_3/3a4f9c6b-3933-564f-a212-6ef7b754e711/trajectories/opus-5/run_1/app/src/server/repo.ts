import type {
  DiffEntry,
  ResourceHealth,
  ResourceSync,
  FreezeBreak,
  FreezePolicyVersion,
  HealthRow,
  HealthTimelineEntry,
  HistoryEntry,
  Overrides,
  Promotion,
  PromotionCounter,
  PromotionKind,
  PromotionState,
  ProjectRole,
  SyncWindow,
  WindowDecision,
} from '../shared/types.js';
import { hhMmFromMinutes } from '../shared/zone.js';
import { query, queryOne, runner, type QueryValue, type Tx } from './db.js';
import { inSyncCounter } from './domain/counter.js';
import { railPosition } from './domain/rail.js';
import { ACTIVE_STATES } from './domain/transitions.js';

export interface PersonRow {
  id: string;
  email: string;
  name: string;
}

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
}

export interface ClusterRow {
  id: string;
  project_id: string;
  name: string;
  time_zone: string;
  agent_token: string;
}

export interface StageRow {
  id: string;
  project_id: string;
  name: string;
  cluster_id: string;
  upstream_stage_id: string | null;
  requires_approval: boolean;
  defaults: Overrides;
  position: number;
  cluster_name: string;
  time_zone: string;
  upstream_name: string | null;
}

export interface BundleRow {
  id: string;
  project_id: string;
  version: string;
  digest: string;
  source_commit: string;
  manifests: Record<string, unknown>[];
  resources: { ref: string; kind: string; namespace: string; name: string }[];
  ingested_at: Date;
  ingested_by: string;
}

export interface PromotionRow {
  id: string;
  project_id: string;
  stage_id: string;
  bundle_id: string;
  kind: PromotionKind;
  state: PromotionState;
  overrides: Overrides;
  diff: DiffEntry[];
  requested_by: string;
  requested_at: Date;
  policy_version: number;
  approval_required: boolean;
  approval_state: 'pending' | 'approved' | 'rejected' | 'expired' | null;
  request_expires_at: Date | null;
  approval_decided_by: string | null;
  approval_decided_at: Date | null;
  approval_expires_at: Date | null;
  approval_comment: string | null;
  restores_promotion_id: string | null;
  freeze_break: FreezeBreak | null;
  degraded_progress: number | null;
  entered_applying_at: Date | null;
  expiry_notified: boolean;
  project_slug: string;
  project_name: string;
  stage_name: string;
  cluster_name: string;
  time_zone: string;
  bundle_version: string;
  bundle_digest: string;
  bundle_source_commit: string;
  requester_email: string;
  requester_name: string;
}

export const PROMOTION_SELECT = `
  SELECT p.*, pr.slug AS project_slug, pr.name AS project_name,
         s.name AS stage_name, c.name AS cluster_name, c.time_zone,
         b.version AS bundle_version, b.digest AS bundle_digest,
         b.source_commit AS bundle_source_commit,
         who.email AS requester_email, who.name AS requester_name
  FROM promotions p
  JOIN projects pr ON pr.id = p.project_id
  JOIN stages s ON s.id = p.stage_id
  JOIN clusters c ON c.id = s.cluster_id
  JOIN bundles b ON b.id = p.bundle_id
  JOIN people who ON who.id = p.requested_by`;

const STAGE_SELECT = `
  SELECT s.*, c.name AS cluster_name, c.time_zone, up.name AS upstream_name
  FROM stages s
  JOIN clusters c ON c.id = s.cluster_id
  LEFT JOIN stages up ON up.id = s.upstream_stage_id`;

export function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, '').slice(0, 7);
}

export async function findPersonByEmail(email: string): Promise<(PersonRow & { password_hash: string }) | null> {
  return queryOne('SELECT id, email, name, password_hash FROM people WHERE email = $1', [email]);
}

export async function findProject(slug: string): Promise<ProjectRow | null> {
  return queryOne('SELECT id, slug, name FROM projects WHERE slug = $1', [slug]);
}

export async function findMembership(projectId: string, personId: string): Promise<ProjectRole | null> {
  const row = await queryOne<{ role: ProjectRole }>(
    'SELECT role FROM memberships WHERE project_id = $1 AND person_id = $2',
    [projectId, personId],
  );
  return row?.role ?? null;
}

export async function listMemberships(personId: string): Promise<{ project: string; role: ProjectRole }[]> {
  return query(
    `SELECT pr.slug AS project, m.role FROM memberships m
     JOIN projects pr ON pr.id = m.project_id
     WHERE m.person_id = $1 ORDER BY pr.slug`,
    [personId],
  );
}

export async function listStages(projectId: string, tx?: Tx): Promise<StageRow[]> {
  return runner(tx).query(`${STAGE_SELECT} WHERE s.project_id = $1 ORDER BY s.position`, [projectId]);
}

export async function findStage(projectId: string, name: string, tx?: Tx): Promise<StageRow | null> {
  return runner(tx).queryOne(`${STAGE_SELECT} WHERE s.project_id = $1 AND s.name = $2`, [projectId, name]);
}

export async function findStageById(stageId: string, tx?: Tx): Promise<StageRow | null> {
  return runner(tx).queryOne(`${STAGE_SELECT} WHERE s.id = $1`, [stageId]);
}

export async function findCluster(projectId: string, name: string): Promise<ClusterRow | null> {
  return queryOne(
    'SELECT id, project_id, name, time_zone, agent_token FROM clusters WHERE project_id = $1 AND name = $2',
    [projectId, name],
  );
}

export async function findClusterByToken(token: string): Promise<ClusterRow | null> {
  return queryOne(
    'SELECT id, project_id, name, time_zone, agent_token FROM clusters WHERE agent_token = $1',
    [token],
  );
}

export async function listClusters(projectId: string): Promise<ClusterRow[]> {
  return query(
    'SELECT id, project_id, name, time_zone, agent_token FROM clusters WHERE project_id = $1 ORDER BY name',
    [projectId],
  );
}

export async function listWindows(clusterId: string, tx?: Tx): Promise<SyncWindow[]> {
  const rows = await runner(tx).query<{
    id: string;
    label: string;
    days: string[];
    start_minutes: number;
    end_minutes: number;
  }>(
    `SELECT id, label, days, start_minutes, end_minutes FROM sync_windows
     WHERE cluster_id = $1 ORDER BY start_minutes, label`,
    [clusterId],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    days: row.days as SyncWindow['days'],
    start: hhMmFromMinutes(row.start_minutes),
    end: hhMmFromMinutes(row.end_minutes),
  }));
}

export async function listFreezeVersions(projectId: string, tx?: Tx): Promise<FreezePolicyVersion[]> {
  const rows = await runner(tx).query<{
    version: number;
    effective_from: Date;
    created_by: string;
    created_at: Date;
    freezes: FreezePolicyVersion['freezes'];
  }>(
    `SELECT version, effective_from, created_by, created_at, freezes
     FROM freeze_policy_versions WHERE project_id = $1 ORDER BY version`,
    [projectId],
  );
  return rows.map((row) => ({
    version: row.version,
    effective_from: row.effective_from.toISOString(),
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    freezes: row.freezes,
  }));
}

export async function findBundleByVersion(projectId: string, version: string): Promise<BundleRow | null> {
  return queryOne(
    `SELECT id, project_id, version, digest, source_commit, manifests, resources, ingested_at, ingested_by
     FROM bundles WHERE project_id = $1 AND version = $2`,
    [projectId, version],
  );
}

export async function findBundleById(bundleId: string, tx?: Tx): Promise<BundleRow | null> {
  return runner(tx).queryOne(
    `SELECT id, project_id, version, digest, source_commit, manifests, resources, ingested_at, ingested_by
     FROM bundles WHERE id = $1`,
    [bundleId],
  );
}

/** Takes the row lock, then returns the promotion as it stands inside the transaction. */
export async function lockPromotion(tx: Tx, promotionId: string): Promise<PromotionRow | null> {
  const held = await tx.queryOne<{ id: string }>(
    'SELECT id FROM promotions WHERE id = $1 FOR UPDATE',
    [promotionId],
  );
  if (!held) return null;
  return tx.queryOne<PromotionRow>(`${PROMOTION_SELECT} WHERE p.id = $1`, [promotionId]);
}

export async function activePromotionRow(stageId: string, tx?: Tx): Promise<PromotionRow | null> {
  const values: QueryValue[] = [stageId, [...ACTIVE_STATES]];
  return runner(tx).queryOne<PromotionRow>(
    `${PROMOTION_SELECT} WHERE p.stage_id = $1 AND p.state = ANY($2::text[]) LIMIT 1`,
    values,
  );
}

/** The stage's current revision: the latest promotion of that stage to have entered applying. */
export async function currentRevisionRow(stageId: string, tx?: Tx): Promise<PromotionRow | null> {
  return runner(tx).queryOne<PromotionRow>(
    `${PROMOTION_SELECT}
     WHERE p.stage_id = $1 AND p.entered_applying_at IS NOT NULL
     ORDER BY p.entered_applying_at DESC, p.seq DESC LIMIT 1`,
    [stageId],
  );
}

export async function healthRows(promotionId: string, tx?: Tx): Promise<HealthRow[]> {
  const rows = await runner(tx).query<HealthRow & { updated_at: Date }>(
    `SELECT ref, kind, namespace, name, sync, health, updated_at
     FROM health_rows WHERE promotion_id = $1 ORDER BY position`,
    [promotionId],
  );
  return rows.map((row) => ({ ...row, updated_at: row.updated_at.toISOString() }));
}

export async function promotionCounter(
  row: PromotionRow,
  tx?: Tx,
): Promise<PromotionCounter | null> {
  if (!row.entered_applying_at) return null;
  return inSyncCounter(await healthRows(row.id, tx));
}

export async function promotionHistory(promotionId: string, tx?: Tx): Promise<HistoryEntry[]> {
  const rows = await runner(tx).query<{
    from_state: PromotionState | null;
    to_state: PromotionState;
    at: Date;
    actor: string;
  }>(
    `SELECT from_state, to_state, at, actor FROM promotion_history
     WHERE promotion_id = $1 ORDER BY id`,
    [promotionId],
  );
  return rows.map((row) => ({
    from: row.from_state,
    to: row.to_state,
    at: row.at.toISOString(),
    by: row.actor,
  }));
}

export async function windowDecisions(promotionId: string, tx?: Tx): Promise<WindowDecision[]> {
  const rows = await runner(tx).query<{ decision: WindowDecision }>(
    'SELECT decision FROM window_decisions WHERE promotion_id = $1 ORDER BY id',
    [promotionId],
  );
  return rows.map((row) => row.decision);
}

export async function healthTimeline(promotionId: string, tx?: Tx): Promise<HealthTimelineEntry[]> {
  const rows = await runner(tx).query<{
    at: Date;
    phase: 'applying' | 'health_wait';
    in_sync: number;
    total: number;
  }>(
    `SELECT at, phase, in_sync, total FROM health_timeline
     WHERE promotion_id = $1 ORDER BY id`,
    [promotionId],
  );
  return rows.map((row) => ({
    at: row.at.toISOString(),
    phase: row.phase,
    in_sync: row.in_sync,
    total: row.total,
  }));
}

export interface EvidenceCounts {
  stored_snapshots: number;
  queued_snapshots: number;
}

function groupBy<Row extends { promotion_id: string }>(rows: Row[]): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.promotion_id);
    if (bucket) bucket.push(row);
    else grouped.set(row.promotion_id, [row]);
  }
  return grouped;
}

/**
 * Assembles promotion objects for a whole list in a fixed number of queries, so listing a
 * stage's history costs the same as reading one promotion.
 */
export async function buildPromotions(rows: PromotionRow[], tx?: Tx): Promise<Promotion[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const db = runner(tx);

  const [health, history, decisions, evidence] = await Promise.all([
    db.query<{ promotion_id: string; sync: ResourceSync; health: ResourceHealth }>(
      `SELECT promotion_id, sync, health FROM health_rows
       WHERE promotion_id = ANY($1::uuid[]) ORDER BY promotion_id, position`,
      [ids],
    ),
    db.query<{
      promotion_id: string;
      from_state: PromotionState | null;
      to_state: PromotionState;
      at: Date;
      actor: string;
    }>(
      `SELECT promotion_id, from_state, to_state, at, actor FROM promotion_history
       WHERE promotion_id = ANY($1::uuid[]) ORDER BY promotion_id, id`,
      [ids],
    ),
    db.query<{ promotion_id: string; decision: WindowDecision }>(
      `SELECT promotion_id, decision FROM window_decisions
       WHERE promotion_id = ANY($1::uuid[]) ORDER BY promotion_id, id`,
      [ids],
    ),
    db.query<{ promotion_id: string; stored: boolean }>(
      `SELECT promotion_id, stored FROM object_uploads
       WHERE promotion_id = ANY($1::uuid[]) AND snapshot_number IS NOT NULL`,
      [ids],
    ),
  ]);

  const healthByPromotion = groupBy(health);
  const historyByPromotion = groupBy(history);
  const decisionsByPromotion = groupBy(decisions);
  const evidenceByPromotion = groupBy(evidence);

  return rows.map((row) => {
    const rowsForPromotion = healthByPromotion.get(row.id) ?? [];
    const counter = row.entered_applying_at ? inSyncCounter(rowsForPromotion) : null;
    const snapshots = evidenceByPromotion.get(row.id) ?? [];
    return assemble(row, {
      counter,
      history: (historyByPromotion.get(row.id) ?? []).map((entry) => ({
        from: entry.from_state,
        to: entry.to_state,
        at: entry.at.toISOString(),
        by: entry.actor,
      })),
      decision: (decisionsByPromotion.get(row.id) ?? []).at(-1)?.decision ?? null,
      evidence: {
        stored_snapshots: snapshots.filter((snapshot) => snapshot.stored).length,
        queued_snapshots: snapshots.filter((snapshot) => !snapshot.stored).length,
      },
    });
  });
}

/** Assembles the promotion object the API returns everywhere "promotion" appears. */
export async function buildPromotion(row: PromotionRow, tx?: Tx): Promise<Promotion> {
  const built = (await buildPromotions([row], tx))[0];
  if (!built) throw new Error(`Promotion ${row.id} could not be assembled`);
  return built;
}

function assemble(
  row: PromotionRow,
  parts: {
    counter: PromotionCounter | null;
    history: HistoryEntry[];
    decision: WindowDecision | null;
    evidence: EvidenceCounts;
  },
): Promotion {
  const { counter, history, decision, evidence } = parts;
  const rail = railPosition(row.state, counter, row.degraded_progress);

  return {
    id: row.id,
    project: row.project_slug,
    stage: row.stage_name,
    cluster: row.cluster_name,
    time_zone: row.time_zone,
    kind: row.kind,
    state: row.state,
    phase: rail.phase,
    progress: rail.progress,
    bundle: {
      version: row.bundle_version,
      digest: row.bundle_digest,
      short_digest: shortDigest(row.bundle_digest),
      source_commit: row.bundle_source_commit,
    },
    overrides: row.overrides,
    requested_by: { email: row.requester_email, name: row.requester_name },
    requested_at: row.requested_at.toISOString(),
    policy_version: row.policy_version,
    approval: row.approval_required
      ? {
          state: row.approval_state ?? 'pending',
          request_expires_at: (row.request_expires_at ?? row.requested_at).toISOString(),
          decided_by: row.approval_decided_by,
          decided_at: row.approval_decided_at?.toISOString() ?? null,
          expires_at: row.approval_expires_at?.toISOString() ?? null,
          comment: row.approval_comment,
        }
      : null,
    window_decision: decision,
    freeze_break: row.freeze_break,
    restores: row.restores_promotion_id,
    counter,
    evidence,
    diff: row.diff,
    history,
  };
}
