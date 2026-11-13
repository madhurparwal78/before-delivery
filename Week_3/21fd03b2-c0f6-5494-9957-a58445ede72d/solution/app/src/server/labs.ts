import { createHash } from "node:crypto";
import { canonicalJson } from "../shared/canonical";
import { COPY } from "../shared/copy";
import { findObject, type SceneDocument } from "../shared/doc";
import { RIG_PARAMS } from "../shared/params";
import { SOLVER_ITERATIONS } from "../shared/sim";
import { OWNER_ONLY, logActivity, projectAccess, requireRole, sceneAccess } from "./access";
import { assetBytesReply } from "./assets";
import { config } from "./config";
import { pool, one, tx } from "./db";
import { ApiError, linkNotFound, notFound, validation } from "./errors";
import { STREAMED, route, type Ctx, type Reply } from "./http";
import { newId, newToken } from "./ids";
import { deliverNow, enqueueMail, publishMail, shareMail } from "./mail";
import { notifyScene } from "./live";
import { currentDocument, labJson, readVerify, runVerify, sceneJson, snapshotBytes, assetJson, type AssetRow } from "./scenes";
import { s3 } from "./services/s3";

const record = (body: unknown): Record<string, unknown> => (typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {});
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPOSED_MAX = 8;

interface Bundle {
  assets: Array<{ assetId: string; kind: string; scaleToMetres: number; sha256: string }>;
  bundleVersion: 1;
  checkpointId: string;
  document: SceneDocument;
  exposed: string[];
  solver: { iterations: number; step: string };
}

function exposedKeysValid(value: unknown, doc: SceneDocument): value is string[] {
  if (!Array.isArray(value) || value.length > EXPOSED_MAX || new Set(value).size !== value.length) return false;
  return value.every((key) => {
    if (typeof key !== "string") return false;
    const dot = key.indexOf(".");
    const object = dot > 0 ? findObject(doc, key.slice(0, dot)) : undefined;
    return Boolean(object && object.kind !== "model" && RIG_PARAMS[object.kind].some((d) => d.key === key.slice(dot + 1)));
  });
}

async function publishScene(ctx: Ctx): Promise<Reply> {
  const { scene, role } = await sceneAccess(ctx.params.sid, ctx.user);
  requireRole(role, OWNER_ONLY);
  await s3.ping();
  const body = record(ctx.body);
  const checkpoint = typeof body.checkpointId === "string" ? await one<{ id: string }>(pool, "SELECT id FROM checkpoints WHERE id = $1 AND scene_id = $2", [body.checkpointId, scene.id]) : undefined;
  if (scene.status === "draft" || !checkpoint) throw new ApiError(409, "no_checkpoint", "Save a checkpoint before publishing.");
  const snapshot = Buffer.from(await snapshotBytes(scene.id, checkpoint.id)).toString("utf8");
  const document = JSON.parse(snapshot) as SceneDocument;
  if (!exposedKeysValid(body.exposed, document)) throw validation({ exposed: COPY.exposed });
  const ids = document.objects.flatMap((o) => (o.assetId ? [o.assetId] : []));
  const rows = ids.length > 0 ? (await pool.query<AssetRow>("SELECT * FROM assets WHERE project_id = $1 AND id = ANY($2)", [scene.project_id, ids])).rows : [];
  const assets = rows.map((a) => ({ assetId: a.id, kind: a.kind, scaleToMetres: a.scale_to_metres as number, sha256: a.sha256 })).sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1));
  const bundle: Bundle = { assets, bundleVersion: 1, checkpointId: checkpoint.id, document, exposed: body.exposed, solver: { iterations: SOLVER_ITERATIONS, step: "1/120" } };
  const bundleBytes = Buffer.from(canonicalJson(bundle), "utf8");
  const bundleHash = createHash("sha256").update(bundleBytes).digest("hex");
  await s3.put(`labs/${scene.id}/${bundleHash}.json`, bundleBytes);
  const { lab, mailId } = await tx(async (db) => {
    await db.query("SELECT 1 FROM scenes WHERE id = $1 FOR UPDATE", [scene.id]);
    const row = await one<{ token: string; bundle_hash: string; published_at: Date; checkpoint_id: string; exposed: string[] }>(
      db,
      `INSERT INTO labs (scene_id, token, bundle_hash, published_at, checkpoint_id, exposed) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (scene_id) DO UPDATE SET bundle_hash = $3, published_at = $4, checkpoint_id = $5, exposed = $6 RETURNING *`,
      [scene.id, newToken(), bundleHash, ctx.now, checkpoint.id, JSON.stringify(bundle.exposed)],
    );
    const published = labJson(row as NonNullable<typeof row>);
    await db.query("UPDATE scenes SET status = 'published' WHERE id = $1", [scene.id]);
    await logActivity(db, scene.workspace_id, ctx.user.id, "scene.published", scene.name, ctx.now);
    const mail = publishMail(scene.name, published.url, bundleHash);
    return { lab: published, mailId: await enqueueMail(db, "publish", ctx.user.email, mail.subject, mail.body, null) };
  });
  notifyScene(scene.id);
  return { status: 201, json: { lab, delivery: await deliverNow(mailId, ctx.user.email) } };
}

async function unpublishScene(ctx: Ctx): Promise<Reply> {
  const { scene, role } = await sceneAccess(ctx.params.sid, ctx.user);
  requireRole(role, OWNER_ONLY);
  if (scene.status !== "published") throw new ApiError(409, "not_published", "This scene is not published.");
  await tx(async (db) => {
    await db.query("DELETE FROM labs WHERE scene_id = $1", [scene.id]);
    await db.query("UPDATE scenes SET status = 'unpublished' WHERE id = $1", [scene.id]);
    await logActivity(db, scene.workspace_id, ctx.user.id, "scene.unpublished", scene.name, ctx.now);
  });
  notifyScene(scene.id);
  return { status: 200, json: { scene: sceneJson({ ...scene, status: "unpublished" }, null) } };
}

async function regenerateLab(ctx: Ctx): Promise<Reply> {
  const { scene, role } = await sceneAccess(ctx.params.sid, ctx.user);
  requireRole(role, OWNER_ONLY);
  if (scene.status !== "published") throw new ApiError(409, "not_published", "This scene is not published.");
  const row = await tx(async (db) => {
    const updated = await one<{ token: string; bundle_hash: string; published_at: Date; checkpoint_id: string; exposed: string[] }>(db, "UPDATE labs SET token = $2 WHERE scene_id = $1 RETURNING *", [scene.id, newToken()]);
    await logActivity(db, scene.workspace_id, ctx.user.id, "lab_link.regenerated", scene.name, ctx.now);
    return updated;
  });
  if (!row) throw new ApiError(409, "not_published", "This scene is not published.");
  return { status: 200, json: { lab: labJson(row) } };
}

interface LabRow {
  scene_id: string;
  token: string;
  bundle_hash: string;
  published_at: Date;
  project_id: string;
}

async function labByToken(token: string): Promise<LabRow> {
  const lab = await one<LabRow>(pool, "SELECT l.scene_id, l.token, l.bundle_hash, l.published_at, s.project_id FROM labs l JOIN scenes s ON s.id = l.scene_id WHERE l.token = $1", [token]);
  if (!lab) throw linkNotFound();
  return lab;
}

async function bundleOf(lab: LabRow): Promise<{ bytes: Uint8Array; bundle: Bundle }> {
  const bytes = await s3.get(`labs/${lab.scene_id}/${lab.bundle_hash}.json`);
  if (!bytes) throw new ApiError(503, "storage_unavailable", "File storage is unreachable.");
  return { bytes, bundle: JSON.parse(Buffer.from(bytes).toString("utf8")) as Bundle };
}

async function getLab(ctx: Ctx): Promise<Reply> {
  const lab = await labByToken(ctx.params.token);
  const { bundle } = await bundleOf(lab);
  const exposed = bundle.exposed.map((key) => {
    const dot = key.indexOf(".");
    const object = findObject(bundle.document, key.slice(0, dot));
    const def = RIG_PARAMS[(object as NonNullable<typeof object>).kind as "ramp"].find((d) => d.key === key.slice(dot + 1));
    const definition = def as NonNullable<typeof def>;
    return {
      key,
      label: `${(object as NonNullable<typeof object>).name}: ${definition.label}`,
      min: definition.min,
      max: definition.max,
      step: definition.step,
      unit: definition.unit,
      value: (object as NonNullable<typeof object>).params[definition.key],
    };
  });
  return { status: 200, json: { lab: { sceneName: bundle.document.name, bundleHash: lab.bundle_hash, publishedAt: lab.published_at.toISOString(), exposed }, bundle } };
}

async function getBundle(ctx: Ctx): Promise<Reply> {
  const lab = await labByToken(ctx.params.token);
  const { bytes } = await bundleOf(lab);
  return { status: 200, bytes, headers: { "content-type": "application/json; charset=utf-8" } };
}

async function getLabAsset(ctx: Ctx): Promise<Reply> {
  const lab = await labByToken(ctx.params.token);
  const { bundle } = await bundleOf(lab);
  const named = bundle.assets.find((a) => a.sha256 === ctx.params.sha256);
  if (!named) throw notFound();
  return assetBytesReply(lab.project_id, { kind: named.kind, sha256: named.sha256 });
}

async function verifyLab(ctx: Ctx): Promise<Reply> {
  const lab = await labByToken(ctx.params.token);
  const { bundle } = await bundleOf(lab);
  return runVerify(lab.project_id, bundle.document, readVerify(ctx.body, bundle.document, new Set(bundle.exposed)));
}

interface LinkRow {
  id: string;
  token: string;
  expires_at: Date;
}
const linkJson = (l: LinkRow): Record<string, unknown> => ({ id: l.id, token: l.token, url: `${config.publicUrl}/view/${l.token}`, expiresAt: l.expires_at.toISOString() });

async function createLink(ctx: Ctx): Promise<Reply> {
  const project = await projectAccess(ctx.params.pid, ctx.user);
  requireRole(project.role, OWNER_ONLY);
  const email = record(ctx.body).email;
  if (email !== undefined && email !== null && (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim()))) throw validation({ email: COPY.email });
  const to = typeof email === "string" ? email.trim() : null;
  const id = newId();
  const token = newToken();
  const expiresAt = new Date(ctx.now.getTime() + config.shareLinkTtlSeconds * 1000);
  const mailId = await tx(async (db) => {
    await db.query("INSERT INTO share_links (id, project_id, token, created_at, expires_at) VALUES ($1,$2,$3,$4,$5)", [id, ctx.params.pid, token, ctx.now, expiresAt]);
    await logActivity(db, project.workspaceId, ctx.user.id, "share_link.created", project.name, ctx.now);
    if (!to) return null;
    const mail = shareMail(ctx.user.displayName, project.name, token, expiresAt);
    return enqueueMail(db, "share", to, mail.subject, mail.body, token);
  });
  const delivery = mailId === null || to === null ? null : await deliverNow(mailId, to);
  return { status: 201, json: { link: linkJson({ id, token, expires_at: expiresAt }), delivery } };
}

async function listLinks(ctx: Ctx): Promise<Reply> {
  const project = await projectAccess(ctx.params.pid, ctx.user);
  requireRole(project.role, OWNER_ONLY);
  const rows = await pool.query<LinkRow>("SELECT id, token, expires_at FROM share_links WHERE project_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY created_at, id", [ctx.params.pid, ctx.now]);
  return { status: 200, json: { links: rows.rows.map(linkJson) } };
}

async function ownLink(ctx: Ctx): Promise<{ link: LinkRow; projectId: string; workspaceId: string; projectName: string }> {
  const row = await one<LinkRow & { project_id: string }>(pool, "SELECT id, token, expires_at, project_id FROM share_links WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2", [ctx.params.id, ctx.now]);
  if (!row) throw notFound();
  const project = await projectAccess(row.project_id, ctx.user);
  requireRole(project.role, OWNER_ONLY);
  return { link: row, projectId: row.project_id, workspaceId: project.workspaceId, projectName: project.name };
}

async function regenerateLink(ctx: Ctx): Promise<Reply> {
  const own = await ownLink(ctx);
  const expiresAt = new Date(ctx.now.getTime() + config.shareLinkTtlSeconds * 1000);
  const token = newToken();
  await tx(async (db) => {
    await db.query("UPDATE share_links SET token = $2, expires_at = $3 WHERE id = $1", [own.link.id, token, expiresAt]);
    await logActivity(db, own.workspaceId, ctx.user.id, "share_link.regenerated", own.projectName, ctx.now);
  });
  return { status: 201, json: { link: linkJson({ id: own.link.id, token, expires_at: expiresAt }) } };
}

async function revokeLink(ctx: Ctx): Promise<Reply> {
  const own = await ownLink(ctx);
  await tx(async (db) => {
    await db.query("UPDATE share_links SET revoked_at = $2 WHERE id = $1", [own.link.id, ctx.now]);
    await logActivity(db, own.workspaceId, ctx.user.id, "share_link.revoked", own.projectName, ctx.now);
  });
  return { status: 204, bytes: new Uint8Array() };
}

async function liveLink(token: string, now: Date): Promise<{ projectId: string; projectName: string } | null> {
  const row = await one<{ project_id: string; name: string }>(
    pool,
    "SELECT l.project_id, p.name FROM share_links l JOIN projects p ON p.id = l.project_id WHERE l.token = $1 AND l.revoked_at IS NULL AND l.expires_at > $2",
    [token, now],
  );
  return row ? { projectId: row.project_id, projectName: row.name } : null;
}

async function viewLink(ctx: Ctx): Promise<{ projectId: string; projectName: string }> {
  const link = await liveLink(ctx.params.token, ctx.now);
  if (!link) throw linkNotFound();
  return link;
}

async function viewProject(ctx: Ctx): Promise<Reply> {
  const link = await viewLink(ctx);
  const scenes = await pool.query<{ id: string; name: string; state_hash: string }>("SELECT id, name, state_hash FROM scenes WHERE project_id = $1 ORDER BY created_at, id", [link.projectId]);
  return { status: 200, json: { project: { name: link.projectName }, scenes: scenes.rows.map((s) => ({ id: s.id, name: s.name, stateHash: s.state_hash })) } };
}

async function viewSceneRow(ctx: Ctx): Promise<{ projectId: string; id: string; name: string; revision: number; state_hash: string }> {
  const link = await viewLink(ctx);
  const scene = await one<{ id: string; name: string; revision: number; state_hash: string }>(pool, "SELECT id, name, revision, state_hash FROM scenes WHERE id = $1 AND project_id = $2", [ctx.params.sid, link.projectId]);
  if (!scene) throw linkNotFound();
  return { ...scene, projectId: link.projectId };
}

async function viewScene(ctx: Ctx): Promise<Reply> {
  const scene = await viewSceneRow(ctx);
  const current = await currentDocument(pool, scene.id);
  const ids = current.doc.objects.flatMap((o) => (o.assetId ? [o.assetId] : []));
  const assets = ids.length > 0 ? await pool.query<AssetRow>("SELECT * FROM assets WHERE project_id = $1 AND id = ANY($2) AND kind IN ('glb','gltf') ORDER BY created_at, id", [scene.projectId, ids]) : { rows: [] as AssetRow[] };
  return {
    status: 200,
    json: { scene: { id: scene.id, name: current.doc.name, revision: current.revision, stateHash: scene.state_hash }, document: current.doc, assets: assets.rows.map(assetJson) },
  };
}

async function viewAsset(ctx: Ctx): Promise<Reply> {
  const link = await viewLink(ctx);
  const asset = await one<AssetRow>(pool, "SELECT * FROM assets WHERE project_id = $1 AND sha256 = $2 AND kind IN ('glb','gltf')", [link.projectId, ctx.params.sha256]);
  if (!asset) throw linkNotFound();
  return assetBytesReply(link.projectId, asset);
}

async function viewVerify(ctx: Ctx): Promise<Reply> {
  const scene = await viewSceneRow(ctx);
  const current = await currentDocument(pool, scene.id);
  return runVerify(scene.projectId, current.doc, readVerify(ctx.body, current.doc, null));
}

const VIEW_POLL_MS = 1000;

async function viewLive(ctx: Ctx): Promise<typeof STREAMED> {
  const scene = await viewSceneRow(ctx);
  ctx.res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  ctx.res.write(": open\n\n");
  let lastRevision = -1;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        if (!(await liveLink(ctx.params.token, new Date()))) {
          ctx.res.write("event: link_dead\ndata: {}\n\n");
          ctx.res.end();
          return;
        }
        const row = await one<{ revision: number; state_hash: string }>(pool, "SELECT revision, state_hash FROM scenes WHERE id = $1", [scene.id]);
        if (row && row.revision !== lastRevision) {
          lastRevision = row.revision;
          ctx.res.write(`event: revision\ndata: ${JSON.stringify({ revision: row.revision, stateHash: row.state_hash })}\n\n`);
        }
      } finally {
        busy = false;
      }
    })().catch(() => undefined);
  }, VIEW_POLL_MS);
  ctx.req.on("close", () => clearInterval(timer));
  return STREAMED;
}

export function registerLabRoutes(): void {
  route("POST", "/api/scenes/:sid/publish", publishScene);
  route("POST", "/api/scenes/:sid/unpublish", unpublishScene);
  route("POST", "/api/scenes/:sid/lab-link/regenerate", regenerateLab);
  route("GET", "/api/labs/:token", getLab, { public: true });
  route("GET", "/api/labs/:token/bundle", getBundle, { public: true });
  route("GET", "/api/labs/:token/assets/:sha256", getLabAsset, { public: true });
  route("POST", "/api/labs/:token/verify", verifyLab, { public: true });
  route("POST", "/api/projects/:pid/share-links", createLink);
  route("GET", "/api/projects/:pid/share-links", listLinks);
  route("POST", "/api/share-links/:id/regenerate", regenerateLink);
  route("DELETE", "/api/share-links/:id", revokeLink);
  route("GET", "/api/view/:token", viewProject, { public: true });
  route("GET", "/api/view/:token/scenes/:sid", viewScene, { public: true });
  route("GET", "/api/view/:token/scenes/:sid/live", viewLive, { public: true });
  route("GET", "/api/view/:token/assets/:sha256", viewAsset, { public: true });
  route("POST", "/api/view/:token/scenes/:sid/verify", viewVerify, { public: true });
}

