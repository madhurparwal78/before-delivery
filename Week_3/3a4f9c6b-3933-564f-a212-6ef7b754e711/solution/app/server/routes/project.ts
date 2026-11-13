// The project graph, the installation status and release bundles.
import { createHash } from "node:crypto";
import { type Bundle, type Graph, type GraphEdge, type GraphNode, type Overrides, type Resource, shortDigest } from "../../shared/api.js";
import { authorize, projectFor } from "../access.js";
import { sessionUser } from "../auth.js";
import { ACTIVE_STATES, pool, withTx } from "../db.js";
import { type Manifest, refOf } from "../domain/diff.js";
import { currentRevisions } from "../domain/health.js";
import { IDLE, reachedOf, stageStatus } from "../domain/rail.js";
import { loadPromotions } from "../domain/records.js";
import { ApiError, invalid } from "../errors.js";
import { body, json, type Ctx, type Reply } from "../http.js";
import { serviceStatus } from "../outbox.js";
import { putObject } from "../storage.js";
import { isRecord } from "../validate.js";

export async function readStatus(ctx: Ctx): Promise<Reply> {
  await sessionUser(pool, ctx);
  return json(200, await serviceStatus());
}

export async function readGraph(ctx: Ctx, [slug = ""]: string[]): Promise<Reply> {
  const member = await projectFor(pool, await sessionUser(pool, ctx), slug);
  const { rows: stages } = await pool.query<{
    id: string; name: string; upstream: string | null; requires_approval: boolean; defaults: Overrides; cluster: string; time_zone: string;
    last_healthy_at: Date | null;
  }>(
    `SELECT s.id, s.name, u.name AS upstream, s.requires_approval, s.defaults, c.name AS cluster, c.time_zone,
            (SELECT max(healthy_at) FROM promotions x WHERE x.stage_id = s.id) AS last_healthy_at
       FROM stages s JOIN clusters c ON c.id = s.cluster_id LEFT JOIN stages u ON u.id = s.upstream_id
      WHERE s.project_id = $1 ORDER BY s.position`, [member.id]);
  const stageIds = stages.map((s) => s.id);
  const [active, latest, current] = await Promise.all([
    pool.query<{ stage_id: string; id: string }>(
      "SELECT stage_id, id FROM promotions WHERE stage_id = ANY($1) AND state = ANY($2)", [stageIds, ACTIVE_STATES]),
    pool.query<{ stage_id: string; id: string }>(
      "SELECT DISTINCT ON (stage_id) stage_id, id FROM promotions WHERE stage_id = ANY($1) ORDER BY stage_id, requested_at DESC", [stageIds]),
    currentRevisions(pool, stageIds),
  ]);
  const activeOf = new Map(active.rows.map((r) => [r.stage_id, r.id]));
  const latestOf = new Map(latest.rows.map((r) => [r.stage_id, r.id]));
  const ids = [...new Set([...activeOf.values(), ...latestOf.values(), ...current.values()])];
  const views = new Map((await loadPromotions(pool, ids)).map(({ view }) => [view.id, view]));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const s of stages) {
    const activePromotion = views.get(activeOf.get(s.id) ?? "") ?? null;
    const revision = views.get(current.get(s.id) ?? "") ?? null;
    const last = views.get(latestOf.get(s.id) ?? "") ?? null;
    nodes.push({
      stage: s.name,
      cluster: s.cluster,
      time_zone: s.time_zone,
      upstream: s.upstream,
      requires_approval: s.requires_approval,
      status: stageStatus(activePromotion?.state ?? null, revision?.state ?? null),
      current: revision ? { promotion_id: revision.id, version: revision.bundle.version, short_digest: revision.bundle.short_digest } : null,
      counter: revision?.counter ?? null,
      active_promotion: activePromotion,
      defaults: s.defaults,
      last_healthy_at: s.last_healthy_at?.toISOString() ?? null,
    });
    const rail = last ? { phase: last.phase, progress: last.progress } : IDLE;
    edges.push({ from: s.upstream ?? "bundles", to: s.name, ...rail, reached: reachedOf(rail), promotion_id: last?.id ?? null });
  }
  const graph: Graph = { project: { slug: member.slug, name: member.name }, role: member.role, nodes, edges };
  return json(200, graph);
}

interface BundleRecord {
  id: string; version: string; digest: string; source_commit: string; resources: Resource[];
  ingested_at: Date; ingested_by: string; verified_in: string[];
}

function bundleOf(r: BundleRecord): Bundle {
  return { ...r, short_digest: shortDigest(r.digest), ingested_at: r.ingested_at.toISOString() };
}

export async function listBundles(ctx: Ctx, [slug = ""]: string[]): Promise<Reply> {
  const member = await projectFor(pool, await sessionUser(pool, ctx), slug);
  const { rows } = await pool.query<BundleRecord>(
    `SELECT b.id, b.version, b.digest, b.source_commit, b.resources, b.ingested_at, u.email AS ingested_by,
            coalesce(array_agg(s.name ORDER BY s.position) FILTER (WHERE s.id IS NOT NULL), '{}') AS verified_in
       FROM bundles b JOIN users u ON u.id = b.ingested_by
       LEFT JOIN stages s ON s.id IN (SELECT x.stage_id FROM promotions x WHERE x.bundle_id = b.id AND x.healthy_at IS NOT NULL)
      WHERE b.project_id = $1 GROUP BY b.id, u.email ORDER BY b.ingested_at DESC, b.version`, [member.id]);
  return json(200, { bundles: rows.map(bundleOf) });
}

const VERSION = /^[A-Za-z0-9.+-]{1,64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const NAME = /^[a-z0-9.-]{1,253}$/;
const MANIFESTS = "Each manifest needs apiVersion, kind and metadata.name.";

function isManifest(value: unknown): value is Manifest {
  if (!isRecord(value) || typeof value.apiVersion !== "string" || typeof value.kind !== "string" || !value.kind) return false;
  const metadata = value.metadata;
  return isRecord(metadata) && typeof metadata.name === "string" && NAME.test(metadata.name)
    && (metadata.namespace === undefined || (typeof metadata.namespace === "string" && NAME.test(metadata.namespace)));
}

export async function ingestBundle(ctx: Ctx, [slug = ""]: string[]): Promise<Reply> {
  const user = await sessionUser(pool, ctx);
  const member = await projectFor(pool, user, slug);
  authorize(member, "ingest");
  const input = body(ctx);
  const fields: Record<string, string> = {};
  const record = isRecord(input) ? input : {};
  const { version, source_commit: commit, manifests } = record;
  if (typeof version !== "string" || !VERSION.test(version)) fields.version = "Use 1 to 64 letters, digits, dots, plus or minus signs.";
  if (typeof commit !== "string" || !COMMIT.test(commit)) fields.source_commit = "Use the full 40-character commit.";
  if (!Array.isArray(manifests) || manifests.length < 1 || manifests.length > 200 || !manifests.every(isManifest)) {
    fields.manifests = MANIFESTS;
  } else {
    const seen = new Set<string>();
    const duplicate = manifests.map(refOf).find((ref) => seen.size === seen.add(ref).size);
    if (duplicate) fields.manifests = `Duplicate resource ${duplicate}.`;
  }
  if (Object.keys(fields).length) throw invalid(fields);
  const valid = { version: version as string, source_commit: commit as string, manifests: manifests as Manifest[] };
  const { rows: existing } = await pool.query("SELECT 1 FROM bundles WHERE project_id = $1 AND version = $2", [member.id, valid.version]);
  if (existing.length) throw new ApiError("version_exists", `Version ${valid.version} already exists in this project.`);
  const object = Buffer.from(JSON.stringify(valid), "utf8");
  const hex = createHash("sha256").update(object).digest("hex");
  const resources: Resource[] = valid.manifests.map((m) => ({
    ref: refOf(m), kind: m.kind, namespace: m.metadata.namespace ?? "default", name: m.metadata.name,
  }));
  // Claim the version first, store the object only for the claimant, and commit only once the object is stored:
  // a losing ingest is refused at the unique index before it writes anything to object storage.
  try {
    const row = await withTx(async (tx) => {
      const { rows } = await tx.query<BundleRecord>(
        `INSERT INTO bundles (project_id, version, digest, source_commit, object, stored_at, resources, ingested_at, ingested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $8)
         RETURNING id, version, digest, source_commit, resources, ingested_at, $9::text AS ingested_by, '{}'::text[] AS verified_in`,
        [member.id, valid.version, `sha256:${hex}`, valid.source_commit, object, ctx.now, JSON.stringify(resources), user.id, user.email]);
      await putObject(`bundles/${member.slug}/${hex}.json`, object, "Object storage is unreachable, so the bundle was not stored.");
      return rows[0] as BundleRecord;
    });
    return json(201, bundleOf(row));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new ApiError("version_exists", `Version ${valid.version} already exists in this project.`);
    throw error;
  }
}
