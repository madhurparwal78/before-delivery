import { db } from './db.js';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { bundleKey, putObject } from './storage.js';

interface SeedPerson { email: string; name: string }
interface SeedCluster { id: string; project: string; name: string; zone: string; token: string }
interface SeedStage { project: string; name: string; cluster: string; upstream: string | null; approval: boolean; position: number; defaults: { parameters: Record<string, string>; replicas: Record<string, number> } }

const PEOPLE: SeedPerson[] = [
  { email: 'ines.okafor@keelson.test', name: 'Ines Okafor' },
  { email: 'tomas.reyes@keelson.test', name: 'Tomás Reyes' },
  { email: 'mei.lindqvist@keelson.test', name: 'Mei Lindqvist' },
  { email: 'hana.sato@keelson.test', name: 'Hana Sato' },
  { email: 'olu.adeyemi@keelson.test', name: 'Olu Adeyemi' },
  { email: 'kofi.brandt@keelson.test', name: 'Kofi Brandt' },
  { email: 'ravi.castell@keelson.test', name: 'Ravi Castell' },
  { email: 'june.park@keelson.test', name: 'June Park' },
];

const MEMBERSHIPS: { email: string; project: string; role: string }[] = [
  { email: 'ines.okafor@keelson.test', project: 'payments-core', role: 'platform_engineer' },
  { email: 'tomas.reyes@keelson.test', project: 'payments-core', role: 'service_developer' },
  { email: 'mei.lindqvist@keelson.test', project: 'payments-core', role: 'service_developer' },
  { email: 'hana.sato@keelson.test', project: 'payments-core', role: 'release_manager' },
  { email: 'olu.adeyemi@keelson.test', project: 'payments-core', role: 'release_manager' },
  { email: 'kofi.brandt@keelson.test', project: 'payments-core', role: 'oncall_sre' },
  { email: 'ravi.castell@keelson.test', project: 'claims-hub', role: 'service_developer' },
  { email: 'june.park@keelson.test', project: 'claims-hub', role: 'release_manager' },
];

const CLUSTERS: SeedCluster[] = [
  { id: 'pc-lon1-nonprod', project: 'payments-core', name: 'lon1-nonprod', zone: 'Europe/London', token: 'agt-pc-lon1-nonprod-5e1f' },
  { id: 'pc-lon1-prod', project: 'payments-core', name: 'lon1-prod', zone: 'Europe/London', token: 'agt-pc-lon1-prod-8a2c' },
  { id: 'pc-use1-prod', project: 'payments-core', name: 'use1-prod', zone: 'America/New_York', token: 'agt-pc-use1-prod-3d7b' },
  { id: 'pc-sin1-prod', project: 'payments-core', name: 'sin1-prod', zone: 'Asia/Singapore', token: 'agt-pc-sin1-prod-9c4e' },
  { id: 'ch-fra1-nonprod', project: 'claims-hub', name: 'fra1-nonprod', zone: 'Europe/Berlin', token: 'agt-ch-fra1-nonprod-2b6a' },
  { id: 'ch-use2-prod', project: 'claims-hub', name: 'use2-prod', zone: 'America/Chicago', token: 'agt-ch-use2-prod-7f3d' },
];

const STAGES: SeedStage[] = [
  { project: 'payments-core', name: 'dev', cluster: 'lon1-nonprod', upstream: null, approval: false, position: 0, defaults: { parameters: { LOG_LEVEL: 'debug' }, replicas: { 'Deployment/payments/payments-api': 1 } } },
  { project: 'payments-core', name: 'staging', cluster: 'lon1-nonprod', upstream: 'dev', approval: false, position: 1, defaults: { parameters: { LOG_LEVEL: 'info' }, replicas: { 'Deployment/payments/payments-api': 2 } } },
  { project: 'payments-core', name: 'prod-eu', cluster: 'lon1-prod', upstream: 'staging', approval: true, position: 2, defaults: { parameters: { LOG_LEVEL: 'warn' }, replicas: { 'Deployment/payments/payments-api': 4 } } },
  { project: 'payments-core', name: 'prod-us', cluster: 'use1-prod', upstream: 'staging', approval: true, position: 3, defaults: { parameters: { LOG_LEVEL: 'warn' }, replicas: { 'Deployment/payments/payments-api': 4 } } },
  { project: 'payments-core', name: 'prod-apac', cluster: 'sin1-prod', upstream: 'staging', approval: true, position: 4, defaults: { parameters: { LOG_LEVEL: 'warn' }, replicas: { 'Deployment/payments/payments-api': 4 } } },
  { project: 'claims-hub', name: 'dev', cluster: 'fra1-nonprod', upstream: null, approval: false, position: 0, defaults: { parameters: {}, replicas: {} } },
  { project: 'claims-hub', name: 'staging', cluster: 'fra1-nonprod', upstream: 'dev', approval: false, position: 1, defaults: { parameters: {}, replicas: {} } },
  { project: 'claims-hub', name: 'prod-us', cluster: 'use2-prod', upstream: 'staging', approval: true, position: 2, defaults: { parameters: {}, replicas: {} } },
];

const WINDOWS: { clusterId: string; label: string; days: string[]; start: string; end: string }[] = [
  { clusterId: 'pc-lon1-prod', label: 'EU change window', days: ['tue'], start: '09:00', end: '12:00' },
  { clusterId: 'pc-sin1-prod', label: 'APAC business hours', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '10:00', end: '16:00' },
];

interface Manifest { apiVersion: string; kind: string; metadata: { name: string; namespace?: string } & Record<string, unknown>; [k: string]: unknown }

function paymentsManifests(payouts: string, password: string, apiKey: string, imageTag: string): Manifest[] {
  return [
    { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'payments-api-config', namespace: 'payments' }, data: { FEATURE_PAYOUTS: payouts } },
    { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'payments-db', namespace: 'payments' }, type: 'Opaque', stringData: { password } },
    { apiVersion: 'bitnami.com/v1alpha1', kind: 'SealedSecret', metadata: { name: 'payments-psp-key', namespace: 'payments' }, spec: { encryptedData: { apiKey } } },
    { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'payments-api', namespace: 'payments' }, spec: { replicas: 2, template: { spec: { containers: [{ name: 'api', image: `registry.keelson.test/payments-api:${imageTag}` }] } } } },
    { apiVersion: 'v1', kind: 'Service', metadata: { name: 'payments-api', namespace: 'payments' }, spec: { ports: [{ port: 443 }] } },
  ];
}

interface SeedBundle { project: string; version: string; sourceCommit: string; manifests: Manifest[] }

const BUNDLES: SeedBundle[] = [
  {
    project: 'payments-core', version: '1.5.0', sourceCommit: '9e3b5d7f1a2c4e6b8d0f1a3c5e7b9d2f4a6c8e01',
    manifests: paymentsManifests('on', 'pc-db-pass-1.5-ZETA', 'AgB7sealedPSPkey15', '1.5.0'),
  },
  {
    project: 'payments-core', version: '1.4.0', sourceCommit: '4a1c9e0b7d2f63a85e19c04b7f3d2a6e8c5b1f90',
    manifests: paymentsManifests('off', 'pc-db-pass-1.4-THETA', 'AgB4sealedPSPkey14', '1.4.0'),
  },
  {
    project: 'claims-hub', version: '2.0.0', sourceCommit: 'c0ffee1234567890abcdef1234567890abcdef12',
    manifests: [
      { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'claims-api', namespace: 'claims' }, spec: { replicas: 2, template: { spec: { containers: [{ name: 'api', image: 'registry.keelson.test/claims-api:2.0.0' }] } } } },
      { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'claims-db', namespace: 'claims' }, type: 'Opaque', stringData: { password: 'ch-db-pass-2.0-KAPPA' } },
    ],
  },
];

// name-key: 1.4.0 (history order per the brief's promotion table)
interface SeedPromotion {
  marker: string; project: string; bundleVersion: string; stageName: string; requestedBy: string; requestedAt: string;
  approval?: { by: string; at: string };
}
const PROMOTIONS: SeedPromotion[] = [
  { marker: 'pc-1.4.0-dev', project: 'payments-core', bundleVersion: '1.4.0', stageName: 'dev', requestedBy: 'tomas.reyes@keelson.test', requestedAt: '2026-10-19T08:00:00Z' },
  { marker: 'pc-1.4.0-staging', project: 'payments-core', bundleVersion: '1.4.0', stageName: 'staging', requestedBy: 'tomas.reyes@keelson.test', requestedAt: '2026-10-19T10:00:00Z' },
  { marker: 'pc-1.4.0-prod-eu', project: 'payments-core', bundleVersion: '1.4.0', stageName: 'prod-eu', requestedBy: 'tomas.reyes@keelson.test', requestedAt: '2026-10-20T08:00:00Z', approval: { by: 'hana.sato@keelson.test', at: '2026-10-20T08:30:00Z' } },
  { marker: 'pc-1.4.0-prod-us', project: 'payments-core', bundleVersion: '1.4.0', stageName: 'prod-us', requestedBy: 'tomas.reyes@keelson.test', requestedAt: '2026-10-20T08:00:00Z', approval: { by: 'hana.sato@keelson.test', at: '2026-10-20T08:30:00Z' } },
  { marker: 'pc-1.4.0-prod-apac', project: 'payments-core', bundleVersion: '1.4.0', stageName: 'prod-apac', requestedBy: 'tomas.reyes@keelson.test', requestedAt: '2026-10-20T08:00:00Z', approval: { by: 'hana.sato@keelson.test', at: '2026-10-20T08:30:00Z' } },
  { marker: 'pc-1.5.0-dev', project: 'payments-core', bundleVersion: '1.5.0', stageName: 'dev', requestedBy: 'mei.lindqvist@keelson.test', requestedAt: '2026-10-22T08:00:00Z' },
  { marker: 'pc-1.5.0-staging', project: 'payments-core', bundleVersion: '1.5.0', stageName: 'staging', requestedBy: 'mei.lindqvist@keelson.test', requestedAt: '2026-10-22T10:00:00Z' },
  { marker: 'ch-2.0.0-dev', project: 'claims-hub', bundleVersion: '2.0.0', stageName: 'dev', requestedBy: 'ravi.castell@keelson.test', requestedAt: '2026-10-21T09:00:00Z' },
];

function manifestRef(m: Manifest): { ref: string; kind: string; namespace: string; name: string } {
  const ns = m.metadata.namespace ?? 'default';
  return { ref: `${m.kind}/${ns}/${m.metadata.name}`, kind: m.kind, namespace: ns, name: m.metadata.name };
}

function hashPassword(password: string): string {
  return crypto.scryptSync(password, 'keelson-seed-salt', 32).toString('hex');
}

export async function applySchemaAndSeed(): Promise<void> {
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.query(schema);

  const passwordHash = hashPassword('keelson-demo-2026');
  for (const p of PEOPLE) {
    await db.query(
      `INSERT INTO people (email, name, password_hash) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
      [p.email, p.name, passwordHash],
    );
  }
  for (const proj of [{ slug: 'payments-core', name: 'Payments Core' }, { slug: 'claims-hub', name: 'Claims Hub' }]) {
    await db.query(
      'INSERT INTO projects (slug, name) VALUES ($1,$2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name',
      [proj.slug, proj.name],
    );
  }
  for (const m of MEMBERSHIPS) {
    await db.query(
      `INSERT INTO memberships (person_email, project_slug, role) VALUES ($1,$2,$3)
       ON CONFLICT (person_email, project_slug) DO UPDATE SET role = EXCLUDED.role`,
      [m.email, m.project, m.role],
    );
  }
  for (const c of CLUSTERS) {
    await db.query(
      `INSERT INTO clusters (id, project_slug, name, time_zone, agent_token) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, time_zone = EXCLUDED.time_zone, agent_token = EXCLUDED.agent_token`,
      [c.id, c.project, c.name, c.zone, c.token],
    );
  }
  for (const s of STAGES) {
    const clusterId = CLUSTERS.find((c) => c.project === s.project && c.name === s.cluster)?.id;
    await db.query(
      `INSERT INTO stages (project_slug, name, cluster_id, upstream_id, pipeline_position, requires_approval, defaults)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (project_slug, name) DO UPDATE SET
         cluster_id = EXCLUDED.cluster_id, upstream_id = EXCLUDED.upstream_id,
         pipeline_position = EXCLUDED.pipeline_position, requires_approval = EXCLUDED.requires_approval,
         defaults = EXCLUDED.defaults`,
      [s.project, s.name, clusterId, null, s.position, s.approval, JSON.stringify(s.defaults)],
    );
  }
  // Link upstreams now that every stage exists.
  for (const s of STAGES) {
    if (!s.upstream) continue;
    const me = await db.query<{ id: string }>('SELECT id FROM stages WHERE project_slug = $1 AND name = $2', [s.project, s.name]);
    const up = await db.query<{ id: string }>('SELECT id FROM stages WHERE project_slug = $1 AND name = $2', [s.project, s.upstream]);
    await db.query('UPDATE stages SET upstream_id = $2 WHERE id = $1', [me.rows[0].id, up.rows[0].id]);
  }
  for (const w of WINDOWS) {
    const existing = await db.query('SELECT id FROM sync_windows WHERE cluster_id = $1 AND label = $2', [w.clusterId, w.label]);
    if (existing.rows.length === 0) {
      await db.query(
        'INSERT INTO sync_windows (cluster_id, label, days, "start", "end") VALUES ($1,$2,$3,$4,$5)',
        [w.clusterId, w.label, w.days, w.start, w.end],
      );
    }
  }
  // Freeze policy versions.
  const pcFreezes = [{ name: 'Year-end freeze', stages: ['prod-eu', 'prod-us', 'prod-apac'], starts_at: '2026-12-23T00:00:00Z', ends_at: '2027-01-04T00:00:00Z' }];
  for (const [project, freezes] of [['payments-core', pcFreezes], ['claims-hub', []]] as [string, typeof pcFreezes][]) {
    await db.query(
      `INSERT INTO freeze_policy_versions (project_slug, version, effective_from, created_by, freezes)
       VALUES ($1, 1, '2026-01-01T00:00:00Z', 'ines.okafor@keelson.test', $2)
       ON CONFLICT (project_slug, version) DO UPDATE SET freezes = EXCLUDED.freezes`,
      [project, JSON.stringify(freezes)],
    );
  }

  // Bundles: upload the object first, then record.
  for (const b of BUNDLES) {
    const objectBytes = Buffer.from(JSON.stringify({ version: b.version, source_commit: b.sourceCommit, manifests: b.manifests }));
    const digestHex = crypto.createHash('sha256').update(objectBytes).digest('hex');
    const digest = `sha256:${digestHex}`;
    const resources = b.manifests.map(manifestRef);
    const existing = await db.query<{ id: string }>('SELECT id FROM bundles WHERE project_slug = $1 AND version = $2', [b.project, b.version]);
    if (existing.rows.length === 0) {
      let stored = false;
      try {
        await putObject(bundleKey(b.project, digestHex), objectBytes);
        stored = true;
      } catch {
        stored = false;
      }
      const ins = await db.query<{ id: string }>(
        `INSERT INTO bundles (project_slug, version, digest, source_commit, resources, ingested_at, ingested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [b.project, b.version, digest, b.sourceCommit, JSON.stringify(resources), new Date('2026-10-18T09:00:00Z'), 'tomas.reyes@keelson.test'],
      );
      const bundleId = ins.rows[0].id;
      await db.query('INSERT INTO bundle_uploads (bundle_id, object_key, state) VALUES ($1,$2,$3)', [
        bundleId, bundleKey(b.project, digestHex), stored ? 'stored' : 'queued',
      ]);
    }
  }

  // Seeded promotions.
  const approvalTtl = Number(process.env.KEELSON_APPROVAL_TTL_SECONDS ?? '14400');
  for (const p of PROMOTIONS) {
    const marker = await db.query('SELECT key FROM seed_markers WHERE key = $1', [p.marker]);
    if (marker.rows.length > 0) continue;
    const stageRow = await db.query<{ id: string; cluster_id: string; requires_approval: boolean; defaults: Record<string, unknown> }>(
      'SELECT id, cluster_id, requires_approval, defaults FROM stages WHERE project_slug = $1 AND name = $2',
      [p.project, p.stageName],
    );
    const stage = stageRow.rows[0];
    const bundle = await db.query<{ id: string }>('SELECT id FROM bundles WHERE project_slug = $1 AND version = $2', [p.project, p.bundleVersion]);
    const overrides = stage.defaults as { parameters: Record<string, string>; replicas: Record<string, number> };
    const requestedAt = new Date(p.requestedAt);
    const approvalState = p.approval ? 'approved' : 'none';
    const decidedAt = p.approval ? new Date(p.approval.at) : null;
    const ins = await db.query<{ id: string }>(
      `INSERT INTO promotions (project_slug, stage_id, cluster_id, kind, state, bundle_id, overrides,
         requested_by, requested_at, policy_version, approval_state, request_expires_at,
         approval_decided_by, approval_decided_at, approval_expires_at, approval_comment, last_progress)
       VALUES ($1,$2,$3,'promotion','healthy',$4,$5,$6,$7,1,$8,$9,$10,$11,$12,$13,1) RETURNING id`,
      [
        p.project, stage.id, stage.cluster_id, bundle.rows[0].id, JSON.stringify(overrides),
        p.requestedBy, requestedAt, approvalState,
        stage.requires_approval ? new Date(requestedAt.getTime() + approvalTtl * 1000) : null,
        p.approval?.by ?? null, decidedAt,
        decidedAt ? new Date(decidedAt.getTime() + approvalTtl * 1000) : null,
        p.approval ? 'Seeded approval.' : null,
      ],
    );
    const promoId = ins.rows[0].id;
    const resources = await db.query<{ resources: { ref: string }[] }>('SELECT resources FROM bundles WHERE id = $1', [bundle.rows[0].id]);
    for (const r of resources.rows[0].resources) {
      await db.query(
        "INSERT INTO health_rows (promotion_id, ref, sync, health) VALUES ($1,$2,'Synced','Healthy')",
        [promoId, r.ref],
      );
    }
    const total = resources.rows[0].resources.length;
    await db.query(
      'INSERT INTO health_timeline (promotion_id, phase, in_sync, total) VALUES ($1, $2, $3, $4)',
      [promoId, 'health_wait', total, total],
    );
    await db.query(
      `INSERT INTO promotion_history (promotion_id, from_state, to_state, at, by)
       VALUES ($1,NULL,'requested',$2,$3), ($1,'requested',$4,$2,'system'), ($1,$4,$5,$6,'system')`,
      [promoId, requestedAt, p.requestedBy, 'applying', 'healthy', new Date(requestedAt.getTime() + 600_000)],
    );
    if (p.approval) {
      await db.query(
        `INSERT INTO promotion_history (promotion_id, from_state, to_state, at, by)
         VALUES ($1,'requested','awaiting_approval',$2,'system'), ($1,'awaiting_approval','approved',$3,$4), ($1,'approved','queued',$3,'system')`,
        [promoId, requestedAt, decidedAt, p.approval.by],
      );
      await db.query(
        'INSERT INTO approval_links (token, promotion_id) VALUES ($1,$2) ON CONFLICT (token) DO NOTHING',
        [crypto.randomBytes(24).toString('base64url'), promoId],
      );
    }
    await db.query('INSERT INTO seed_markers (key) VALUES ($1) ON CONFLICT (key) DO NOTHING', [p.marker]);
  }
}
