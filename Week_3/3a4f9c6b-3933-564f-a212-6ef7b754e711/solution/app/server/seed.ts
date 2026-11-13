// The schema and the seed data (brief: Seed data), applied idempotently at every start.
// Seeded promotions pass through the same transitions, window check and snapshot rules as live ones.
// Passwords and agent tokens are stored as hashes only.
import { createHash } from "node:crypto";
import type { Overrides, Role } from "../shared/api.js";
import { pool, SCHEMA, type Tx } from "./db.js";
import { type Manifest, diffRevisions, refOf } from "./domain/diff.js";
import { queueSnapshot } from "./domain/evidence.js";
import { counters, currentRevisions } from "./domain/health.js";
import { SYSTEM, type StageRow, approvalDeadline, enterApplying, frozenOverrides, judgeWindow, revisionOf, stageByName } from "./domain/promotions.js";
import type { PromotionRow } from "./domain/records.js";
import { moveTo, recordRequested } from "./domain/transitions.js";

const SEED_LOCK = 7_310_431;

const PEOPLE: { name: string; email: string; hash: string; roles: Record<string, Role> }[] = [
  { name: "Ines Okafor", email: "ines.okafor@keelson.test", hash: "scrypt$U4iWkbqQ19k1Lck10caRzw==$sfWMQeMemsVmYEZJ7NEuw+49BsOz4qaaUpEk3U8rZwM=", roles: { "payments-core": "platform_engineer" } },
  { name: "Tomás Reyes", email: "tomas.reyes@keelson.test", hash: "scrypt$fBsXekRXZMwD39mtDt1/4A==$TtuMiizs/+x0Nqf+Zaq5cF1wqcPBzkLuI0d3OQ0HoTw=", roles: { "payments-core": "service_developer" } },
  { name: "Mei Lindqvist", email: "mei.lindqvist@keelson.test", hash: "scrypt$bs+KPq1nLp4HzGKctgVFRw==$M0zVwZ8g0Sldnmw5WH468tP2GSJ5Z5IwOrxBV9qeTq8=", roles: { "payments-core": "service_developer" } },
  { name: "Hana Sato", email: "hana.sato@keelson.test", hash: "scrypt$+dD7aUNCcy61HgS9M7OSMw==$6ouTQyGEghTHJ4EB8wWg6L9R1nHvsGDeACeNBukuqxE=", roles: { "payments-core": "release_manager" } },
  { name: "Olu Adeyemi", email: "olu.adeyemi@keelson.test", hash: "scrypt$oFZmNnB6OzfwaKkhlvKcDA==$ngsABTUW+SuViOqvyeYLsACTtPGaQnp3e0UJdMe+csw=", roles: { "payments-core": "release_manager" } },
  { name: "Kofi Brandt", email: "kofi.brandt@keelson.test", hash: "scrypt$7zhMzQMOk9DTQCRikXQ2Ng==$/GjuRtPe/L7i5rd35oC5VixlMWw6gbmp01IOqRBjGqM=", roles: { "payments-core": "oncall_sre" } },
  { name: "Ravi Castell", email: "ravi.castell@keelson.test", hash: "scrypt$8QsJI8PQNLFjjlRejwNd1A==$//3pIEqsogqCYV1kXf/QJH36wazZ67mUY6VrnBXkl60=", roles: { "claims-hub": "service_developer" } },
  { name: "June Park", email: "june.park@keelson.test", hash: "scrypt$iHlYFjidNgAhEpDk2B+f7A==$p/Iynq5kQtjIpd2EOjxuoY2HiSFE8uxDfkD7u2Fa+ZY=", roles: { "claims-hub": "release_manager" } },
];

const PROJECTS = [{ slug: "payments-core", name: "Payments Core" }, { slug: "claims-hub", name: "Claims Hub" }];

const CLUSTERS = [
  { project: "payments-core", name: "lon1-nonprod", zone: "Europe/London", tokenHash: "d5ccc96d9add97d4701cbc4648d4baa6b2ab86438a452c6a123e5fc4e1b7a10d" },
  { project: "payments-core", name: "lon1-prod", zone: "Europe/London", tokenHash: "1f89dbe9c9df55a8c0a385ed9aadab269552986593444717374167575a0900f2" },
  { project: "payments-core", name: "use1-prod", zone: "America/New_York", tokenHash: "1195d4102f4c4752be161deb12d1be583feb9a32b5744fc81ae95973809d9752" },
  { project: "payments-core", name: "sin1-prod", zone: "Asia/Singapore", tokenHash: "7fa2255a71cba4422b29e23a20e2c379e89dac2b90bddfde573915eb2950d641" },
  { project: "claims-hub", name: "fra1-nonprod", zone: "Europe/Berlin", tokenHash: "1fe98b793918d012ed500cdfc210e279c75550956b5248324b0be6c34ae38aea" },
  { project: "claims-hub", name: "use2-prod", zone: "America/Chicago", tokenHash: "3aa60e1e58bed29c525f95b6db028568c0ce1dd6a73bd6f0394ced0ea899e5d1" },
];

const API_REF = "Deployment/payments/payments-api";
const defaults = (level: string, replicas: number): Overrides => ({ parameters: { LOG_LEVEL: level }, replicas: { [API_REF]: replicas } });
const NONE: Overrides = { parameters: {}, replicas: {} };

const STAGES: { project: string; name: string; cluster: string; upstream: string | null; approval: boolean; defaults: Overrides }[] = [
  { project: "payments-core", name: "dev", cluster: "lon1-nonprod", upstream: null, approval: false, defaults: defaults("debug", 1) },
  { project: "payments-core", name: "staging", cluster: "lon1-nonprod", upstream: "dev", approval: false, defaults: defaults("info", 2) },
  { project: "payments-core", name: "prod-eu", cluster: "lon1-prod", upstream: "staging", approval: true, defaults: defaults("warn", 4) },
  { project: "payments-core", name: "prod-us", cluster: "use1-prod", upstream: "staging", approval: true, defaults: defaults("warn", 4) },
  { project: "payments-core", name: "prod-apac", cluster: "sin1-prod", upstream: "staging", approval: true, defaults: defaults("warn", 4) },
  { project: "claims-hub", name: "dev", cluster: "fra1-nonprod", upstream: null, approval: false, defaults: NONE },
  { project: "claims-hub", name: "staging", cluster: "fra1-nonprod", upstream: "dev", approval: false, defaults: NONE },
  { project: "claims-hub", name: "prod-us", cluster: "use2-prod", upstream: "staging", approval: true, defaults: NONE },
];

const WINDOWS = [
  { cluster: "lon1-prod", label: "EU change window", days: ["tue"], start: "09:00", end: "12:00" },
  { cluster: "sin1-prod", label: "APAC business hours", days: ["mon", "tue", "wed", "thu", "fri"], start: "10:00", end: "16:00" },
];

const YEAR_END = { name: "Year-end freeze", stages: ["prod-eu", "prod-us", "prod-apac"], starts_at: "2026-12-23T00:00:00.000Z", ends_at: "2027-01-04T00:00:00.000Z" };

function paymentsManifests(v: { flag: string; password: string; apiKey: string; tag: string }): Manifest[] {
  return [
    { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "payments-api-config", namespace: "payments" }, data: { FEATURE_PAYOUTS: v.flag } },
    { apiVersion: "v1", kind: "Secret", metadata: { name: "payments-db", namespace: "payments" }, type: "Opaque", stringData: { password: v.password } },
    { apiVersion: "bitnami.com/v1alpha1", kind: "SealedSecret", metadata: { name: "payments-psp-key", namespace: "payments" }, spec: { encryptedData: { apiKey: v.apiKey } } },
    { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "payments-api", namespace: "payments" },
      spec: { replicas: 2, template: { spec: { containers: [{ name: "api", image: `registry.keelson.test/payments-api:${v.tag}` }] } } } },
    { apiVersion: "v1", kind: "Service", metadata: { name: "payments-api", namespace: "payments" }, spec: { ports: [{ port: 443 }] } },
  ];
}

const BUNDLES = [
  { project: "payments-core", version: "1.4.0", commit: "4a1c9e0b7d2f63a85e19c04b7f3d2a6e8c5b1f90", by: "tomas.reyes@keelson.test", at: "2026-10-19T07:30:00Z",
    manifests: paymentsManifests({ flag: "off", password: "pc-db-pass-1.4-THETA", apiKey: "AgB4sealedPSPkey14", tag: "1.4.0" }) },
  { project: "claims-hub", version: "2.0.0", commit: "c0ffee1234567890abcdef1234567890abcdef12", by: "ravi.castell@keelson.test", at: "2026-10-21T08:30:00Z",
    manifests: [
      { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "claims-api", namespace: "claims" },
        spec: { replicas: 2, template: { spec: { containers: [{ name: "api", image: "registry.keelson.test/claims-api:2.0.0" }] } } } },
      { apiVersion: "v1", kind: "Secret", metadata: { name: "claims-db", namespace: "claims" }, stringData: { password: "ch-db-pass-2.0-KAPPA" } },
    ] as Manifest[] },
  { project: "payments-core", version: "1.5.0", commit: "9e3b5d7f1a2c4e6b8d0f1a3c5e7b9d2f4a6c8e01", by: "mei.lindqvist@keelson.test", at: "2026-10-22T07:30:00Z",
    manifests: paymentsManifests({ flag: "on", password: "pc-db-pass-1.5-ZETA", apiKey: "AgB7sealedPSPkey15", tag: "1.5.0" }) },
];

interface SeedPromotion {
  project: string;
  version: string;
  stage: string;
  by: string;
  at: string;
  approval?: { by: string; at: string };
  freezeBreak?: { by: string; at: string; reason: string };
}

const PROMOTIONS: SeedPromotion[] = [
  { project: "payments-core", version: "1.4.0", stage: "dev", by: "tomas.reyes@keelson.test", at: "2026-10-19T08:00:00Z" },
  { project: "payments-core", version: "1.4.0", stage: "staging", by: "tomas.reyes@keelson.test", at: "2026-10-19T10:00:00Z" },
  ...["prod-eu", "prod-us", "prod-apac"].map((stage) => ({
    project: "payments-core", version: "1.4.0", stage, by: "tomas.reyes@keelson.test", at: "2026-10-20T08:00:00Z",
    approval: { by: "hana.sato@keelson.test", at: "2026-10-20T08:30:00Z" },
    // 08:30 UTC is 16:30 in Singapore, after APAC business hours, so the seeded APAC rollout was moved on by a freeze break.
    freezeBreak: { by: "kofi.brandt@keelson.test", at: "2026-10-20T08:35:00Z", reason: "Payout fix for APAC merchants could not wait for business hours." },
  })),
  { project: "claims-hub", version: "2.0.0", stage: "dev", by: "ravi.castell@keelson.test", at: "2026-10-21T09:00:00Z" },
  { project: "payments-core", version: "1.5.0", stage: "dev", by: "mei.lindqvist@keelson.test", at: "2026-10-22T08:00:00Z" },
  { project: "payments-core", version: "1.5.0", stage: "staging", by: "mei.lindqvist@keelson.test", at: "2026-10-22T10:00:00Z" },
];

const HEALTHY_AFTER_MS = 10 * 60_000;

async function seedPromotion(tx: Tx, ids: Map<string, string>, s: SeedPromotion): Promise<void> {
  const projectId = ids.get(s.project) as string;
  const stage = (await stageByName(tx, projectId, s.stage)) as StageRow;
  const { rows: [bundle] } = await tx.query<{ id: string; object: Buffer; resources: { ref: string }[] }>(
    "SELECT id, object, resources FROM bundles WHERE project_id = $1 AND version = $2", [projectId, s.version]);
  const requester = ids.get(s.by) as string;
  const manifests = (JSON.parse((bundle as { object: Buffer }).object.toString("utf8")) as { manifests: Manifest[] }).manifests;
  const overrides = frozenOverrides(stage.defaults, NONE, new Set(manifests.map(refOf)));
  const current = (await currentRevisions(tx, [stage.id])).get(stage.id);
  const previous = current ? await revisionOf(tx, current) : null;
  const requestedAt = new Date(s.at);
  const decidedAt = s.approval ? new Date(s.approval.at) : null;
  const { rows: [created] } = await tx.query<PromotionRow>(
    `INSERT INTO promotions (project_id, stage_id, kind, state, bundle_id, overrides, requested_by, requested_at, policy_version, diff,
                             approval_state, request_expires_at, decided_by, decided_at, approval_expires_at)
     VALUES ($1, $2, 'promotion', 'requested', $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [projectId, stage.id, (bundle as { id: string }).id, JSON.stringify(overrides), requester, requestedAt,
      JSON.stringify(diffRevisions({ manifests, overrides }, previous)),
      s.approval ? "approved" : null, s.approval ? approvalDeadline(requestedAt) : null,
      s.approval ? ids.get(s.approval.by) : null, decidedAt, decidedAt ? approvalDeadline(decidedAt) : null]);
  const p = created as PromotionRow;
  await recordRequested(tx, p.id, s.by, requestedAt);
  let at = requestedAt;
  if (s.approval && decidedAt) {
    await moveTo(tx, p, "awaiting_approval", "request", SYSTEM, requestedAt);
    await moveTo(tx, p, "approved", "approve", s.approval.by, decidedAt);
    await moveTo(tx, p, "queued", "start", s.by, decidedAt);
    at = decidedAt;
  } else {
    await moveTo(tx, p, "queued", "request", SYSTEM, requestedAt);
  }
  if ((await judgeWindow(tx, p, stage, at)).open) {
    await enterApplying(tx, p, "window_check", SYSTEM, at);
  } else if (s.freezeBreak) {
    await moveTo(tx, p, "window_blocked", "window_check", SYSTEM, at);
    at = new Date(s.freezeBreak.at);
    await tx.query("UPDATE promotions SET freeze_break = $2 WHERE id = $1",
      [p.id, JSON.stringify({ by: s.freezeBreak.by, at: at.toISOString(), reason: s.freezeBreak.reason })]);
    await moveTo(tx, p, "queued", "break_freeze", s.freezeBreak.by, at);
    await enterApplying(tx, p, "break_freeze", s.freezeBreak.by, at);
  }
  const healthyAt = new Date(at.getTime() + HEALTHY_AFTER_MS);
  await tx.query("UPDATE health_rows SET sync = 'Synced', health = 'Healthy', updated_at = $2 WHERE promotion_id = $1", [p.id, healthyAt]);
  const counter = (await counters(tx, [p.id])).get(p.id);
  await tx.query("UPDATE promotions SET healthy_at = $2, health_timeline = $3 WHERE id = $1",
    [p.id, healthyAt, JSON.stringify([{ at: healthyAt.toISOString(), phase: "health_wait", ...counter }])]);
  await moveTo(tx, p, "healthy", "report", `agent:${stage.cluster_name}`, healthyAt);
  await queueSnapshot(tx, p.id, healthyAt);
}

async function seed(tx: Tx): Promise<void> {
  const ids = new Map<string, string>();
  const insert = async (sql: string, params: unknown[]) => ((await tx.query<{ id: string }>(sql, params)).rows[0] as { id: string }).id;
  for (const person of PEOPLE) {
    ids.set(person.email, await insert("INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [person.email, person.name, person.hash]));
  }
  for (const project of PROJECTS) {
    ids.set(project.slug, await insert("INSERT INTO projects (slug, name) VALUES ($1, $2) RETURNING id", [project.slug, project.name]));
  }
  for (const person of PEOPLE) {
    for (const [slug, role] of Object.entries(person.roles)) {
      await tx.query("INSERT INTO memberships (user_id, project_id, role) VALUES ($1, $2, $3)", [ids.get(person.email), ids.get(slug), role]);
    }
  }
  for (const [position, c] of CLUSTERS.entries()) {
    ids.set(`${c.project}/${c.name}`, await insert(
      "INSERT INTO clusters (project_id, name, time_zone, agent_token_hash, position) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [ids.get(c.project), c.name, c.zone, c.tokenHash, position]));
  }
  for (const [position, s] of STAGES.entries()) {
    ids.set(`${s.project}/stage/${s.name}`, await insert(
      `INSERT INTO stages (project_id, name, cluster_id, upstream_id, requires_approval, position, defaults)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [ids.get(s.project), s.name, ids.get(`${s.project}/${s.cluster}`), s.upstream ? ids.get(`${s.project}/stage/${s.upstream}`) : null,
        s.approval, position, JSON.stringify(s.defaults)]));
  }
  for (const w of WINDOWS) {
    await tx.query("INSERT INTO sync_windows (cluster_id, label, days, start_time, end_time, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [ids.get(`payments-core/${w.cluster}`), w.label, w.days, w.start, w.end, new Date("2026-01-01T00:00:00Z")]);
  }
  for (const [slug, freezes] of [["payments-core", [YEAR_END]], ["claims-hub", []]] as const) {
    await tx.query(
      `INSERT INTO freeze_policy_versions (project_id, version, effective_from, created_by, created_at, freezes)
       VALUES ($1, 1, $2, $3, $2, $4)`,
      [ids.get(slug), new Date("2026-01-01T00:00:00Z"), ids.get(slug === "payments-core" ? "ines.okafor@keelson.test" : "june.park@keelson.test"),
        JSON.stringify(freezes)]);
  }
  for (const b of BUNDLES) {
    const object = Buffer.from(JSON.stringify({ version: b.version, source_commit: b.commit, manifests: b.manifests }), "utf8");
    const resources = b.manifests.map((m) => ({ ref: refOf(m), kind: m.kind, namespace: m.metadata.namespace ?? "default", name: m.metadata.name }));
    await tx.query(
      `INSERT INTO bundles (project_id, version, digest, source_commit, object, resources, ingested_at, ingested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ids.get(b.project), b.version, `sha256:${createHash("sha256").update(object).digest("hex")}`, b.commit, object,
        JSON.stringify(resources), new Date(b.at), ids.get(b.by)]);
  }
  for (const promotion of PROMOTIONS) await seedPromotion(tx, ids, promotion);
}

/** Applies the schema, then the seed when the database is empty; one instance at a time. */
export async function prepareDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SEED_LOCK]);
    await client.query(SCHEMA);
    const { rows } = await client.query("SELECT 1 FROM projects LIMIT 1");
    if (rows.length === 0) {
      await client.query("BEGIN");
      try {
        await seed(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SEED_LOCK]).catch(() => undefined);
    client.release();
  }
}
