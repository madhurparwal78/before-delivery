import { createHash } from 'node:crypto';
import type { BundleResource, Overrides } from '../shared/types.js';
import { hashPassword } from './auth.js';
import { transaction, type Tx } from './db.js';
import { buildDiff, manifestRef } from './domain/diff.js';
import { decideWindow } from './domain/window-check.js';
import { bundleKey, queueSnapshot } from './evidence.js';
import { lockPromotion } from './repo.js';
import {
  BUNDLES,
  CLUSTERS,
  FREEZE_POLICIES,
  PEOPLE,
  PROJECTS,
  PROMOTIONS,
  SEED_PASSWORD,
  STAGES,
  SYNC_WINDOWS,
} from './seed-data.js';
import { recordObject } from './services/queues.js';

/** Stable ids keep the seed idempotent across restarts. */
function stableId(kind: string, key: string): string {
  const digest = createHash('sha1').update(`keelson:${kind}:${key}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function bundleObjectBytes(
  version: string,
  sourceCommit: string,
  manifests: Record<string, unknown>[],
): Buffer {
  return Buffer.from(JSON.stringify({ version, source_commit: sourceCommit, manifests }), 'utf8');
}

export function digestOf(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function resourcesOf(manifests: Record<string, unknown>[]): BundleResource[] {
  return manifests.map((manifest) => {
    const metadata = (manifest.metadata ?? {}) as Record<string, unknown>;
    const namespace = typeof metadata.namespace === 'string' ? metadata.namespace : 'default';
    return {
      ref: manifestRef(manifest),
      kind: String(manifest.kind),
      namespace,
      name: String(metadata.name),
    };
  });
}

function frozenDefaults(defaults: Overrides, resources: BundleResource[]): Overrides {
  const refs = new Set(resources.map((resource) => resource.ref));
  const replicas: Record<string, number> = {};
  for (const [ref, count] of Object.entries(defaults.replicas)) {
    if (refs.has(ref)) replicas[ref] = count;
  }
  return { parameters: { ...defaults.parameters }, replicas };
}

async function seedPeople(tx: Tx): Promise<void> {
  const hash = await hashPassword(SEED_PASSWORD);
  for (const person of PEOPLE) {
    await tx.query(
      `INSERT INTO people (id, email, name, password_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [stableId('person', person.email), person.email, person.name, hash],
    );
  }
}

async function seedProjects(tx: Tx): Promise<void> {
  for (const project of PROJECTS) {
    await tx.query(
      `INSERT INTO projects (id, slug, name) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`,
      [stableId('project', project.slug), project.slug, project.name],
    );
  }
  for (const person of PEOPLE) {
    for (const membership of person.roles) {
      await tx.query(
        `INSERT INTO memberships (project_id, person_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (project_id, person_id) DO NOTHING`,
        [stableId('project', membership.project), stableId('person', person.email), membership.role],
      );
    }
  }
}

async function seedClusters(tx: Tx): Promise<void> {
  for (const cluster of CLUSTERS) {
    await tx.query(
      `INSERT INTO clusters (id, project_id, name, time_zone, agent_token)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (project_id, name) DO NOTHING`,
      [
        stableId('cluster', `${cluster.project}/${cluster.name}`),
        stableId('project', cluster.project),
        cluster.name,
        cluster.timeZone,
        cluster.token,
      ],
    );
  }
}

async function seedStages(tx: Tx): Promise<void> {
  for (const [position, stage] of STAGES.entries()) {
    await tx.query(
      `INSERT INTO stages
         (id, project_id, name, cluster_id, upstream_stage_id, requires_approval, defaults, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id, name) DO NOTHING`,
      [
        stableId('stage', `${stage.project}/${stage.name}`),
        stableId('project', stage.project),
        stage.name,
        stableId('cluster', `${stage.project}/${stage.cluster}`),
        stage.upstream ? stableId('stage', `${stage.project}/${stage.upstream}`) : null,
        stage.requiresApproval,
        stage.defaults,
        position,
      ],
    );
  }
}

async function seedWindows(tx: Tx): Promise<void> {
  for (const window of SYNC_WINDOWS) {
    await tx.query(
      `INSERT INTO sync_windows (id, cluster_id, label, days, start_minutes, end_minutes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (id) DO NOTHING`,
      [
        stableId('window', `${window.project}/${window.cluster}/${window.label}`),
        stableId('cluster', `${window.project}/${window.cluster}`),
        window.label,
        window.days,
        window.start,
        window.end,
      ],
    );
  }
}

async function seedFreezePolicies(tx: Tx): Promise<void> {
  for (const policy of FREEZE_POLICIES) {
    await tx.query(
      `INSERT INTO freeze_policy_versions
         (id, project_id, version, effective_from, created_by, created_at, freezes)
       VALUES ($1, $2, $3, $4, $5, $4, $6)
       ON CONFLICT (project_id, version) DO NOTHING`,
      [
        stableId('freeze-policy', `${policy.project}/${policy.version}`),
        stableId('project', policy.project),
        policy.version,
        policy.effectiveFrom,
        policy.createdBy,
        JSON.stringify(policy.freezes),
      ],
    );
  }
}

async function seedBundles(tx: Tx): Promise<void> {
  for (const bundle of BUNDLES) {
    const bytes = bundleObjectBytes(bundle.version, bundle.sourceCommit, bundle.manifests);
    const digest = digestOf(bytes);
    await tx.query(
      `INSERT INTO bundles
         (id, project_id, version, digest, source_commit, manifests, resources, ingested_at, ingested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (project_id, version) DO NOTHING`,
      [
        stableId('bundle', `${bundle.project}/${bundle.version}`),
        stableId('project', bundle.project),
        bundle.version,
        digest,
        bundle.sourceCommit,
        JSON.stringify(bundle.manifests),
        JSON.stringify(resourcesOf(bundle.manifests)),
        bundle.ingestedAt,
        stableId('person', bundle.ingestedBy),
      ],
    );
    // Seeded bundle objects start in the queue, so they land once storage answers.
    await recordObject(tx, {
      objectKey: bundleKey(bundle.project, digest),
      body: bytes,
      promotionId: null,
      snapshotNumber: null,
      stored: false,
    });
  }
}

interface HistoryStep {
  from: string | null;
  to: string;
  at: string;
  actor: string;
}

function historyFor(promotion: (typeof PROMOTIONS)[number], cluster: string): HistoryStep[] {
  const agent = `agent:${cluster}`;
  const applied = Date.parse(promotion.appliedAt);
  const healthWaitAt = new Date(applied + 60_000).toISOString();
  const healthyAt = new Date(applied + 120_000).toISOString();

  const steps: HistoryStep[] = [
    { from: null, to: 'requested', at: promotion.requestedAt, actor: promotion.requestedBy },
  ];
  if (promotion.approvedBy && promotion.approvedAt) {
    steps.push({ from: 'requested', to: 'awaiting_approval', at: promotion.requestedAt, actor: 'system' });
    steps.push({
      from: 'awaiting_approval',
      to: 'approved',
      at: promotion.approvedAt,
      actor: promotion.approvedBy,
    });
    steps.push({ from: 'approved', to: 'queued', at: promotion.appliedAt, actor: promotion.requestedBy });
  } else {
    steps.push({ from: 'requested', to: 'queued', at: promotion.requestedAt, actor: 'system' });
  }
  steps.push({ from: 'queued', to: 'applying', at: promotion.appliedAt, actor: promotion.requestedBy });
  steps.push({ from: 'applying', to: 'health_wait', at: healthWaitAt, actor: agent });
  steps.push({ from: 'health_wait', to: 'healthy', at: healthyAt, actor: agent });
  return steps;
}

async function seedPromotions(tx: Tx): Promise<void> {
  const APPROVAL_LIFETIME_MS = 4 * 60 * 60 * 1000;

  for (const [index, promotion] of PROMOTIONS.entries()) {
    const promotionId = stableId('promotion', `${promotion.project}/${promotion.stage}/${promotion.version}`);
    const existing = await tx.queryOne<{ id: string }>('SELECT id FROM promotions WHERE id = $1', [
      promotionId,
    ]);
    if (existing) continue;

    const stage = STAGES.find(
      (candidate) => candidate.project === promotion.project && candidate.name === promotion.stage,
    );
    const bundle = BUNDLES.find(
      (candidate) => candidate.project === promotion.project && candidate.version === promotion.version,
    );
    if (!stage || !bundle) throw new Error(`Seed promotion ${index} names an unknown stage or bundle`);

    const cluster = CLUSTERS.find(
      (candidate) => candidate.project === stage.project && candidate.name === stage.cluster,
    );
    if (!cluster) throw new Error(`Seed stage ${stage.name} names an unknown cluster`);

    const resources = resourcesOf(bundle.manifests);
    const overrides = frozenDefaults(stage.defaults, resources);
    const previous = await tx.queryOne<{ manifests: Record<string, unknown>[]; overrides: Overrides }>(
      `SELECT b.manifests, p.overrides FROM promotions p
       JOIN bundles b ON b.id = p.bundle_id
       WHERE p.stage_id = $1 AND p.entered_applying_at IS NOT NULL
       ORDER BY p.entered_applying_at DESC LIMIT 1`,
      [stableId('stage', `${stage.project}/${stage.name}`)],
    );
    const diff = buildDiff(previous, { manifests: bundle.manifests, overrides });
    const approved = promotion.approvedBy !== null && promotion.approvedAt !== null;

    await tx.query(
      `INSERT INTO promotions
         (id, project_id, stage_id, bundle_id, kind, state, overrides, diff, requested_by,
          requested_at, policy_version, approval_required, approval_state, request_expires_at,
          approval_decided_by, approval_decided_at, approval_expires_at, entered_applying_at)
       VALUES ($1, $2, $3, $4, 'promotion', 'healthy', $5, $6, $7, $8, 1, $9, $10, $11, $12, $13, $14, $15)`,
      [
        promotionId,
        stableId('project', promotion.project),
        stableId('stage', `${stage.project}/${stage.name}`),
        stableId('bundle', `${bundle.project}/${bundle.version}`),
        overrides,
        JSON.stringify(diff),
        stableId('person', promotion.requestedBy),
        promotion.requestedAt,
        stage.requiresApproval,
        stage.requiresApproval ? 'approved' : null,
        stage.requiresApproval
          ? new Date(Date.parse(promotion.requestedAt) + APPROVAL_LIFETIME_MS).toISOString()
          : null,
        approved ? promotion.approvedBy : null,
        approved ? promotion.approvedAt : null,
        approved ? new Date(Date.parse(promotion.approvedAt as string) + APPROVAL_LIFETIME_MS).toISOString() : null,
        promotion.appliedAt,
      ],
    );

    for (const step of historyFor(promotion, cluster.name)) {
      await tx.query(
        `INSERT INTO promotion_history (promotion_id, from_state, to_state, at, actor)
         VALUES ($1, $2, $3, $4, $5)`,
        [promotionId, step.from, step.to, step.at, step.actor],
      );
    }

    for (const [position, resource] of resources.entries()) {
      await tx.query(
        `INSERT INTO health_rows
           (promotion_id, ref, kind, namespace, name, sync, health, updated_at, position)
         VALUES ($1, $2, $3, $4, $5, 'Synced', 'Healthy', $6, $7)`,
        [
          promotionId,
          resource.ref,
          resource.kind,
          resource.namespace,
          resource.name,
          new Date(Date.parse(promotion.appliedAt) + 120_000).toISOString(),
          position,
        ],
      );
    }

    await tx.query(
      `INSERT INTO health_timeline (promotion_id, at, phase, in_sync, total)
       VALUES ($1, $2, 'applying', 0, $4), ($1, $3, 'health_wait', $4, $4)`,
      [
        promotionId,
        promotion.appliedAt,
        new Date(Date.parse(promotion.appliedAt) + 60_000).toISOString(),
        resources.length,
      ],
    );

    // These promotions ran before any sync window existed, so each check found nothing to block it.
    const decision = decideWindow({
      instant: new Date(promotion.appliedAt),
      timeZone: cluster.timeZone,
      stage: stage.name,
      windows: [],
      freezes: [],
      policyVersion: 1,
    });
    await tx.query(
      'INSERT INTO window_decisions (promotion_id, decision, created_at) VALUES ($1, $2, $3)',
      [promotionId, decision, promotion.appliedAt],
    );

    const row = await lockPromotion(tx, promotionId);
    if (!row) throw new Error(`Seeded promotion ${promotionId} could not be read back`);
    await queueSnapshot(tx, row);
  }
}

/** Applies the whole seed idempotently, so an empty database and a full one both end up right. */
export async function applySeed(): Promise<void> {
  await transaction(async (tx) => {
    await seedPeople(tx);
    await seedProjects(tx);
    await seedClusters(tx);
    await seedStages(tx);
    await seedWindows(tx);
    await seedFreezePolicies(tx);
    await seedBundles(tx);
    await seedPromotions(tx);
  });
}
