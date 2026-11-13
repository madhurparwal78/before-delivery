import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { db } from './db.js';
import type {
  BundleRef, Decision, DiffEntry, FreezePolicyVersion, HealthRow, HealthTimelineEntry,
  HistoryEntry, Membership, Overrides, PersonRef, PromotionKind, PromotionState,
  PromotionView, Role, SyncWindow,
} from './domain.js';
import {
  instantString, isActiveState, policyVersionInForce, railPhaseAndProgress, shortDigest,
} from './rules.js';
import { bundleKey, getObject } from './storage.js';

export interface StageRow {
  id: string;
  project_slug: string;
  name: string;
  cluster_id: string;
  upstream_id: string | null;
  pipeline_position: number;
  requires_approval: boolean;
  defaults: { parameters: Record<string, string>; replicas: Record<string, number> };
}

export interface ClusterRow {
  id: string;
  project_slug: string;
  name: string;
  time_zone: string;
  agent_token: string;
}

export interface BundleRow {
  id: string;
  project_slug: string;
  version: string;
  digest: string;
  source_commit: string;
  resources: BundleRef[];
  ingested_at: Date;
  ingested_by: string;
}

export interface PromotionRecord {
  id: string;
  project_slug: string;
  stage_id: string;
  cluster_id: string;
  kind: PromotionKind;
  state: PromotionState;
  bundle_id: string;
  overrides: Overrides;
  requested_by: string;
  requested_at: Date;
  policy_version: number;
  approval_state: string;
  request_expires_at: Date | null;
  approval_decided_by: string | null;
  approval_decided_at: Date | null;
  approval_expires_at: Date | null;
  approval_comment: string | null;
  window_decision: Decision | null;
  freeze_break: { by: string; at: string; reason: string } | null;
  restores: string | null;
  failed_progress: string | null;
  last_progress: string;
}

export function hashPassword(password: string): string {
  return crypto.scryptSync(password, 'keelson-seed-salt', 32).toString('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
  return crypto.scryptSync(password, 'keelson-seed-salt', 32).toString('hex') === hash;
}

export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ----------------------------------------------------------------- lookups

export async function findPerson(email: string) {
  const r = await db.query('SELECT email, name, password_hash FROM people WHERE email = $1', [email]);
  return r.rows[0] ?? null;
}

export async function membershipsOf(email: string): Promise<Membership[]> {
  const r = await db.query(
    'SELECT project_slug, role FROM memberships WHERE person_email = $1 ORDER BY project_slug',
    [email],
  );
  return r.rows.map((row) => ({ project: row.project_slug, role: row.role as Role }));
}

export async function membershipIn(email: string, projectSlug: string): Promise<Role | null> {
  const r = await db.query(
    'SELECT role FROM memberships WHERE person_email = $1 AND project_slug = $2',
    [email, projectSlug],
  );
  return (r.rows[0]?.role as Role) ?? null;
}

export async function findProject(slug: string) {
  const r = await db.query('SELECT slug, name FROM projects WHERE slug = $1', [slug]);
  return r.rows[0] ?? null;
}

export async function projectStages(projectSlug: string): Promise<StageRow[]> {
  const r = await db.query(
    'SELECT id, project_slug, name, cluster_id, upstream_id, pipeline_position, requires_approval, defaults FROM stages WHERE project_slug = $1 ORDER BY pipeline_position',
    [projectSlug],
  );
  return r.rows as unknown as StageRow[];
}

export async function findStage(projectSlug: string, stageName: string): Promise<StageRow | null> {
  const r = await db.query(
    'SELECT id, project_slug, name, cluster_id, upstream_id, pipeline_position, requires_approval, defaults FROM stages WHERE project_slug = $1 AND name = $2',
    [projectSlug, stageName],
  );
  return (r.rows[0] as unknown as StageRow) ?? null;
}

export async function stageById(stageId: string): Promise<StageRow | null> {
  const r = await db.query(
    'SELECT id, project_slug, name, cluster_id, upstream_id, pipeline_position, requires_approval, defaults FROM stages WHERE id = $1',
    [stageId],
  );
  return (r.rows[0] as unknown as StageRow) ?? null;
}

export async function findCluster(clusterId: string): Promise<ClusterRow | null> {
  const r = await db.query('SELECT id, project_slug, name, time_zone, agent_token FROM clusters WHERE id = $1', [clusterId]);
  return (r.rows[0] as unknown as ClusterRow) ?? null;
}

export async function projectClusters(projectSlug: string): Promise<ClusterRow[]> {
  const r = await db.query(
    'SELECT id, project_slug, name, time_zone, agent_token FROM clusters WHERE project_slug = $1 ORDER BY name',
    [projectSlug],
  );
  return r.rows as unknown as ClusterRow[];
}

export async function clusterWindows(clusterId: string): Promise<SyncWindow[]> {
  const r = await db.query(
    'SELECT id, label, days, "start", "end" FROM sync_windows WHERE cluster_id = $1 ORDER BY created_at',
    [clusterId],
  );
  return r.rows as unknown as SyncWindow[];
}

export async function bundleByVersion(projectSlug: string, version: string): Promise<BundleRow | null> {
  const r = await db.query(
    'SELECT id, project_slug, version, digest, source_commit, resources, ingested_at, ingested_by FROM bundles WHERE project_slug = $1 AND version = $2',
    [projectSlug, version],
  );
  return (r.rows[0] as unknown as BundleRow) ?? null;
}

export async function bundleById(id: string): Promise<BundleRow | null> {
  const r = await db.query(
    'SELECT id, project_slug, version, digest, source_commit, resources, ingested_at, ingested_by FROM bundles WHERE id = $1',
    [id],
  );
  return (r.rows[0] as unknown as BundleRow) ?? null;
}

export async function projectBundles(projectSlug: string): Promise<BundleRow[]> {
  const r = await db.query(
    'SELECT id, project_slug, version, digest, source_commit, resources, ingested_at, ingested_by FROM bundles WHERE project_slug = $1 ORDER BY ingested_at DESC',
    [projectSlug],
  );
  return r.rows as unknown as BundleRow[];
}

export async function bundleUploadState(bundleId: string): Promise<'stored' | 'queued'> {
  const r = await db.query('SELECT state FROM bundle_uploads WHERE bundle_id = $1', [bundleId]);
  return (r.rows[0]?.state as 'stored' | 'queued') ?? 'stored';
}

export async function bundlesVerifiedInStages(bundleIds: string[]): Promise<Map<string, string[]>> {
  if (bundleIds.length === 0) return new Map();
  const r = await db.query<{ bundle_id: string; stage_id: string }>(
    `SELECT DISTINCT p.bundle_id, p.stage_id FROM promotions p
     JOIN stages s ON s.id = p.stage_id
     WHERE p.bundle_id = ANY($1) AND p.state = 'healthy'`,
    [bundleIds],
  );
  const map = new Map<string, string[]>();
  for (const row of r.rows) {
    const list = map.get(row.bundle_id) ?? [];
    list.push(row.stage_id);
    map.set(row.bundle_id, list);
  }
  return map;
}

export async function freezeVersions(projectSlug: string): Promise<FreezePolicyVersion[]> {
  const r = await db.query(
    'SELECT version, effective_from, created_by, created_at, freezes FROM freeze_policy_versions WHERE project_slug = $1 ORDER BY version',
    [projectSlug],
  );
  return r.rows.map((row) => ({
    version: row.version as number,
    effective_from: instantString(row.effective_from as Date),
    created_by: row.created_by as string,
    created_at: instantString(row.created_at as Date),
    freezes: row.freezes as FreezePolicyVersion['freezes'],
  }));
}

export async function promotionById(id: string): Promise<PromotionRecord | null> {
  const r = await db.query('SELECT * FROM promotions WHERE id = $1', [id]);
  return (r.rows[0] as unknown as PromotionRecord) ?? null;
}

export async function activePromotionOfStage(stageId: string): Promise<PromotionRecord | null> {
  const r = await db.query(
    `SELECT * FROM promotions WHERE stage_id = $1 AND state = ANY($2) ORDER BY requested_at LIMIT 1`,
    [stageId, ['requested', 'awaiting_approval', 'approved', 'queued', 'window_blocked', 'applying', 'health_wait']],
  );
  return (r.rows[0] as unknown as PromotionRecord) ?? null;
}

export async function latestPromotionIntoStage(stageId: string): Promise<PromotionRecord | null> {
  const r = await db.query(
    'SELECT * FROM promotions WHERE stage_id = $1 ORDER BY requested_at DESC, id DESC LIMIT 1',
    [stageId],
  );
  return (r.rows[0] as unknown as PromotionRecord) ?? null;
}

export async function currentRevisionOfStage(stageId: string): Promise<PromotionRecord | null> {
  const r = await db.query(
    `SELECT * FROM promotions WHERE stage_id = $1 AND state IN ('applying','health_wait','healthy','degraded','rolled_back')
     ORDER BY requested_at DESC, id DESC LIMIT 1`,
    [stageId],
  );
  return (r.rows[0] as unknown as PromotionRecord) ?? null;
}

export async function lastHealthyPromotionExcluding(stageId: string, excludeId: string | null): Promise<PromotionRecord | null> {
  if (excludeId === null) {
    const r = await db.query(
      `SELECT * FROM promotions WHERE stage_id = $1 AND state = 'healthy'
       ORDER BY requested_at DESC, id DESC LIMIT 1`,
      [stageId],
    );
    return (r.rows[0] as unknown as PromotionRecord) ?? null;
  }
  const r = await db.query(
    `SELECT * FROM promotions WHERE stage_id = $1 AND state = 'healthy' AND id <> $2
     ORDER BY requested_at DESC, id DESC LIMIT 1`,
    [stageId, excludeId],
  );
  return (r.rows[0] as unknown as PromotionRecord) ?? null;
}

export async function promotionHistory(promotionId: string): Promise<HistoryEntry[]> {
  const r = await db.query(
    'SELECT from_state, to_state, at, by FROM promotion_history WHERE promotion_id = $1 ORDER BY seq',
    [promotionId],
  );
  return r.rows.map((row) => ({
    from: (row.from_state as PromotionState | null) ?? null,
    to: row.to_state as PromotionState,
    at: instantString(row.at as Date),
    by: row.by as string,
  }));
}

export async function healthTimeline(promotionId: string): Promise<HealthTimelineEntry[]> {
  const r = await db.query(
    'SELECT at, phase, in_sync, total FROM health_timeline WHERE promotion_id = $1 ORDER BY seq',
    [promotionId],
  );
  return r.rows.map((row) => ({
    at: instantString(row.at as Date),
    phase: row.phase as 'applying' | 'health_wait',
    in_sync: row.in_sync as number,
    total: row.total as number,
  }));
}

export async function healthRowsOf(promotionId: string): Promise<HealthRow[]> {
  const r = await db.query(
    'SELECT ref, sync, health, updated_at FROM health_rows WHERE promotion_id = $1 ORDER BY ref',
    [promotionId],
  );
  return r.rows.map((row) => ({
    ref: row.ref as string,
    sync: row.sync as HealthRow['sync'],
    health: row.health as HealthRow['health'],
    updated_at: instantString(row.updated_at as Date),
  }));
}

export async function inSyncCounter(promotionId: string): Promise<{ in_sync: number; total: number }> {
  const r = await db.query<{ synced: string; total: string }>(
    `SELECT count(*) FILTER (WHERE sync = 'Synced' AND health = 'Healthy') AS synced, count(*) AS total FROM health_rows WHERE promotion_id = $1`,
    [promotionId],
  );
  return { in_sync: Number(r.rows[0].synced), total: Number(r.rows[0].total) };
}

export async function evidenceCounts(promotionId: string): Promise<{ stored: number; queued: number }> {
  const r = await db.query<{ stored: string; queued: string }>(
    `SELECT count(*) FILTER (WHERE state = 'stored') AS stored, count(*) FILTER (WHERE state = 'queued') AS queued FROM evidence_uploads WHERE promotion_id = $1`,
    [promotionId],
  );
  return { stored: Number(r.rows[0].stored), queued: Number(r.rows[0].queued) };
}

export async function personByEmail(email: string): Promise<PersonRef | null> {
  const r = await db.query('SELECT email, name FROM people WHERE email = $1', [email]);
  return r.rows[0] ? { email: r.rows[0].email, name: r.rows[0].name } : null;
}

export async function releaseManagers(projectSlug: string): Promise<PersonRef[]> {
  const r = await db.query(
    `SELECT p.email, p.name FROM memberships m JOIN people p ON p.email = m.person_email
     WHERE m.project_slug = $1 AND m.role = 'release_manager' ORDER BY p.email`,
    [projectSlug],
  );
  return r.rows.map((row) => ({ email: row.email as string, name: row.name as string }));
}

export async function approvalLinkToken(promotionId: string): Promise<string | null> {
  const r = await db.query('SELECT token FROM approval_links WHERE promotion_id = $1', [promotionId]);
  return (r.rows[0]?.token as string) ?? null;
}

// -------------------------------------------------------------- mutations

export async function appendHistory(
  client: PoolClient | typeof db,
  promotionId: string,
  from: PromotionState | null,
  to: PromotionState,
  by: string,
  at: Date = new Date(),
): Promise<void> {
  await client.query(
    'INSERT INTO promotion_history (promotion_id, from_state, to_state, at, by) VALUES ($1,$2,$3,$4,$5)',
    [promotionId, from, to, at, by],
  );
}

export async function setPromotionState(
  client: PoolClient | typeof db,
  promotionId: string,
  to: PromotionState,
): Promise<void> {
  await client.query('UPDATE promotions SET state = $2 WHERE id = $1', [promotionId, to]);
}

// The stage lock rule. The single place the lock is released: when a promotion
// leaves the active set. Called on every terminal or revision change.
export async function releaseLockIfInactive(client: PoolClient | typeof db, promotionId: string): Promise<void> {
  await client.query(
    `DELETE FROM stage_locks sl
     USING promotions p
     WHERE sl.promotion_id = p.id AND sl.promotion_id = $1
       AND p.state NOT IN ('requested','awaiting_approval','approved','queued','window_blocked','applying','health_wait')`,
    [promotionId],
  );
}

// Try to take the stage lock for a promotion. The single place that enforces
// one active promotion per stage; Postgres decides the winner across instances.
export async function tryTakeStageLock(
  client: PoolClient,
  stageId: string,
  promotionId: string,
): Promise<boolean> {
  const lock = await client.query<{ promotion_id: string }>(
    'SELECT promotion_id FROM stage_locks WHERE stage_id = $1 FOR UPDATE',
    [stageId],
  );
  if (lock.rows.length > 0) return false;
  const ins = await client.query(
    'INSERT INTO stage_locks (stage_id, promotion_id) VALUES ($1,$2) ON CONFLICT (stage_id) DO NOTHING',
    [stageId, promotionId],
  );
  return ins.rowCount === 1;
}

// ------------------------------------------------------------ promotions view

export async function promotionView(promo: PromotionRecord): Promise<PromotionView> {
  const [stage, cluster, bundle, history, counterRows, evidence] = await Promise.all([
    stageById(promo.stage_id),
    findCluster(promo.cluster_id),
    bundleById(promo.bundle_id),
    promotionHistory(promo.id),
    inSyncCounter(promo.id),
    evidenceCounts(promo.id),
  ]);
  const person = await personByEmail(promo.requested_by);
  const counterStates = ['applying', 'health_wait', 'healthy', 'degraded'];
  const hasCounter = counterStates.includes(promo.state) && counterRows.total > 0;
  const { phase, progress } = railPhaseAndProgress(
    promo.state,
    hasCounter ? counterRows.in_sync : null,
    hasCounter ? counterRows.total : null,
    promo.failed_progress ? Number(promo.failed_progress) : null,
  );
  const requiresApproval = promo.approval_state !== 'none';
  return {
    id: promo.id,
    project: promo.project_slug,
    stage: stage?.name ?? '',
    cluster: cluster?.name ?? '',
    time_zone: cluster?.time_zone ?? '',
    kind: promo.kind,
    state: promo.state,
    phase,
    progress,
    bundle: {
      version: bundle?.version ?? '',
      digest: bundle?.digest ?? '',
      short_digest: shortDigest(bundle?.digest ?? ''),
      source_commit: bundle?.source_commit ?? '',
    },
    overrides: promo.overrides,
    requested_by: { email: promo.requested_by, name: person?.name ?? promo.requested_by },
    requested_at: instantString(promo.requested_at),
    policy_version: promo.policy_version,
    approval: requiresApproval
      ? {
          state: promo.approval_state as 'pending' | 'approved' | 'rejected' | 'expired',
          request_expires_at: instantString(promo.request_expires_at as Date),
          decided_by: promo.approval_decided_by,
          decided_at: promo.approval_decided_at ? instantString(promo.approval_decided_at) : null,
          expires_at: promo.approval_expires_at ? instantString(promo.approval_expires_at) : null,
          comment: promo.approval_comment,
        }
      : null,
    window_decision: promo.window_decision,
    freeze_break: promo.freeze_break,
    restores: promo.restores,
    counter: hasCounter ? counterRows : null,
    evidence: { stored_snapshots: evidence.stored, queued_snapshots: evidence.queued },
    diff: await promotionDiff(promo),
    history,
  };
}

export async function promotionViewById(id: string): Promise<PromotionView | null> {
  const promo = await promotionById(id);
  return promo ? promotionView(promo) : null;
}

// The diff rule. The single place that computes a promotion's diff against the
// stage's current revision, with secret redaction applied. Manifests are read
// from object storage, never from the database.
export async function promotionDiff(promo: PromotionRecord): Promise<DiffEntry[]> {
  const current = await currentRevisionOfStage(promo.stage_id);
  const newBundle = await bundleById(promo.bundle_id);
  if (!newBundle) return [];
  const entries: DiffEntry[] = [];
  const oldPromo = current && current.id !== promo.id ? current : null;
  const oldBundle = oldPromo ? await bundleById(oldPromo.bundle_id) : null;

  const newManifests = await manifestsOf(newBundle);
  const oldManifests = oldBundle ? await manifestsOf(oldBundle) : [];

  const byRef = (list: Record<string, unknown>[]) => new Map(
    list.map((m) => {
      const meta = m.metadata as Record<string, unknown>;
      const ns = typeof meta.namespace === 'string' ? meta.namespace : 'default';
      return [`${m.kind}/${ns}/${meta.name}`, m] as [string, Record<string, unknown>];
    }),
  );
  const newRefs = byRef(newManifests);
  const oldRefs = byRef(oldManifests);
  const order: string[] = [];
  for (const ref of newRefs.keys()) order.push(ref);
  for (const ref of oldRefs.keys()) if (!newRefs.has(ref)) order.push(ref);

  for (const ref of order) {
    const after = newRefs.get(ref);
    const before = oldRefs.get(ref);
    if (after && !before) {
      entries.push({ resource: ref, path: '', change: 'added', before: null, after: null });
      continue;
    }
    if (!after && before) {
      entries.push({ resource: ref, path: '', change: 'removed', before: null, after: null });
      continue;
    }
    if (!after || !before) continue;
    const leaves = diffLeaves(before, after, '', secretPathsOf(before).concat(secretPathsOf(after)));
    for (const leaf of leaves) {
      entries.push({ resource: ref, path: leaf.path, change: 'modified', before: leaf.before, after: leaf.after });
    }
  }
  // Override leaves.
  const oldOverrides = oldPromo ? oldPromo.overrides : { parameters: {}, replicas: {} };
  const paramKeys = new Set([...Object.keys(promo.overrides.parameters), ...Object.keys(oldOverrides.parameters)]);
  for (const k of paramKeys) {
    const before = oldOverrides.parameters[k];
    const after = promo.overrides.parameters[k];
    if (before !== after) {
      entries.push({
        resource: 'overrides',
        path: `parameters.${k}`,
        change: 'modified',
        before: before !== undefined ? String(before) : null,
        after: after !== undefined ? String(after) : null,
      });
    }
  }
  const repKeys = new Set([...Object.keys(promo.overrides.replicas), ...Object.keys(oldOverrides.replicas)]);
  for (const k of repKeys) {
    const before = oldOverrides.replicas[k];
    const after = promo.overrides.replicas[k];
    if (before !== after) {
      entries.push({
        resource: 'overrides',
        path: `replicas.${k}`,
        change: 'modified',
        before: before !== undefined ? String(before) : null,
        after: after !== undefined ? String(after) : null,
      });
    }
  }
  return entries;
}

// Reads a bundle's stored manifests from object storage. When the object is
// not reachable (should not happen after a successful ingest) the diff falls
// back to resource presence only.
async function manifestsOf(bundle: BundleRow): Promise<Record<string, unknown>[]> {
  try {
    const bytes = await getObject(bundleKey(bundle.project_slug, bundle.digest.replace(/^sha256:/, '')));
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as { manifests?: Record<string, unknown>[] };
    return Array.isArray(parsed.manifests) ? parsed.manifests : [];
  } catch {
    return [];
  }
}

// Secret-bearing leaf paths of a manifest (Secret data/stringData, SealedSecret
// encryptedData and template data). The redaction rule lives here.
function secretPathsOf(manifest: Record<string, unknown>): string[] {
  const kind = String(manifest.kind ?? '');
  const paths: string[] = [];
  if (kind === 'Secret') {
    for (const base of ['data', 'stringData']) {
      const v = manifest[base];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const k of Object.keys(v as object)) paths.push(`${base}.${k}`);
      }
    }
  } else if (kind === 'SealedSecret') {
    const spec = manifest.spec as Record<string, unknown> | undefined;
    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      const enc = spec.encryptedData as Record<string, unknown> | undefined;
      if (enc && typeof enc === 'object' && !Array.isArray(enc)) {
        for (const k of Object.keys(enc)) paths.push(`spec.encryptedData.${k}`);
      }
      const tpl = spec.template as Record<string, unknown> | undefined;
      if (tpl && typeof tpl === 'object' && !Array.isArray(tpl)) {
        const tdata = tpl.data as Record<string, unknown> | undefined;
        if (tdata && typeof tdata === 'object' && !Array.isArray(tdata)) {
          for (const k of Object.keys(tdata)) paths.push(`spec.template.data.${k}`);
        }
      }
    }
  }
  return paths;
}

// Leaf-level structural diff with dot paths and [i] indexes.
function diffLeaves(before: unknown, after: unknown, path: string, secretPaths: string[]): { path: string; before: string | null; after: string | null }[] {
  if (secretPaths.includes(path)) {
    const same = JSON.stringify(before) === JSON.stringify(after);
    if (same) return [];
    return [{ path, before: '[redacted]', after: '[redacted]' }];
  }
  const bIsObj = before !== null && typeof before === 'object';
  const aIsObj = after !== null && typeof after === 'object';
  if (bIsObj || aIsObj) {
    const out: { path: string; before: string | null; after: string | null }[] = [];
    if (Array.isArray(before) && Array.isArray(after)) {
      const len = Math.max(before.length, after.length);
      for (let i = 0; i < len; i++) {
        out.push(...diffLeaves(before[i], after[i], `${path}[${i}]`, secretPaths));
      }
      return out;
    }
    const bObj = (before ?? {}) as Record<string, unknown>;
    const aObj = (after ?? {}) as Record<string, unknown>;
    const keys = new Set([...Object.keys(bObj), ...Object.keys(aObj)]);
    for (const k of keys) {
      out.push(...diffLeaves(bObj[k], aObj[k], path ? `${path}.${k}` : k, secretPaths));
    }
    return out;
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{
    path,
    before: before === undefined || before === null ? null : String(before),
    after: after === undefined || after === null ? null : String(after),
  }];
}

export { db };
export { isActiveState, policyVersionInForce };
