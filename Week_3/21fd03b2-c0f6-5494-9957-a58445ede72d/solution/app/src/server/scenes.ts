import { canonicalJson } from "../shared/canonical";
import { COPY } from "../shared/copy";
import {
  TEMPLATES,
  allOpKeys,
  applyOp,
  canonicalDocument,
  changedKeys,
  findObject,
  templateDocument,
  touchedKeys,
  validateNewObject,
  validateSceneValue,
  validateSetValue,
  type FieldErrors,
  type Op,
  type SceneDocument,
  type Template,
} from "../shared/doc";
import { boundsOfBytes, type Bounds } from "../shared/gltf";
import { inRange, paramDefs, rangeError, validName } from "../shared/params";
import { MAX_STEPS, Simulation, initialHash } from "../shared/sim";
import { sha256Hex } from "../shared/sha256";
import { CAN_EDIT, logActivity, projectAccess, requireRole, sceneAccess, type SceneRow } from "./access";
import { pool, one, tx, type Db } from "./db";
import { ApiError, notFound, storageUnavailable, validation } from "./errors";
import { route, type Ctx, type Reply } from "./http";
import { newId } from "./ids";
import { notifyScene } from "./live";
import { s3 } from "./services/s3";
import { valkey } from "./services/valkey";
import { loadProject } from "./workspaces";
import { config } from "./config";

const record = (body: unknown): Record<string, unknown> => (typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export async function currentDocument(db: Db, sceneId: string): Promise<{ revision: number; text: string; doc: SceneDocument }> {
  const row = await one<{ revision: number; document: string }>(
    db,
    "SELECT r.revision, r.document FROM scene_revisions r JOIN scenes s ON s.id = r.scene_id AND s.revision = r.revision WHERE s.id = $1",
    [sceneId],
  );
  if (!row) throw notFound();
  return { revision: row.revision, text: row.document, doc: JSON.parse(row.document) as SceneDocument };
}

interface LabInfo {
  token: string;
  url: string;
  bundleHash: string;
  publishedAt: string;
  checkpointId: string;
  exposed: string[];
}

async function labOf(db: Db, sceneId: string): Promise<LabInfo | null> {
  const row = await one<{ token: string; bundle_hash: string; published_at: Date; checkpoint_id: string; exposed: string[] }>(db, "SELECT * FROM labs WHERE scene_id = $1", [sceneId]);
  return row ? labJson(row) : null;
}

export function labJson(row: { token: string; bundle_hash: string; published_at: Date; checkpoint_id: string; exposed: string[] }): LabInfo {
  return { token: row.token, url: `${config.publicUrl}/lab/${row.token}`, bundleHash: row.bundle_hash, publishedAt: row.published_at.toISOString(), checkpointId: row.checkpoint_id, exposed: row.exposed };
}

export interface AssetRow {
  id: string;
  name: string;
  kind: string;
  bytes: number;
  sha256: string;
  unit: string | null;
  scale_to_metres: number | null;
  extent_metres: number | null;
  created_at: Date;
}

export const assetJson = (a: AssetRow): Record<string, unknown> => ({
  id: a.id,
  name: a.name,
  kind: a.kind,
  bytes: a.bytes,
  sha256: a.sha256,
  unit: a.unit,
  scaleToMetres: a.scale_to_metres,
  extentMetres: a.extent_metres,
  createdAt: a.created_at.toISOString(),
});

/** Model bounds of every model the document uses, read from the stored bytes (503 if storage is down). */
async function modelBoundsFor(projectId: string, doc: SceneDocument): Promise<(assetId: string) => Bounds | null> {
  const bounds = new Map<string, Bounds | null>();
  for (const object of doc.objects) {
    if (object.kind !== "model" || object.assetId === null || bounds.has(object.assetId)) continue;
    const asset = await one<{ sha256: string }>(pool, "SELECT sha256 FROM assets WHERE id = $1 AND project_id = $2", [object.assetId, projectId]);
    const bytes = asset ? await s3.get(`assets/${projectId}/${asset.sha256}`) : null;
    bounds.set(object.assetId, bytes ? boundsOfBytes(bytes) : null);
  }
  return (assetId) => bounds.get(assetId) ?? null;
}

async function createScene(ctx: Ctx): Promise<Reply> {
  const project = await projectAccess(ctx.params.pid, ctx.user);
  requireRole(project.role, CAN_EDIT);
  const body = record(ctx.body);
  const name = text(body.name).trim();
  const template = text(body.template);
  const fields: FieldErrors = {};
  if (!validName(name)) fields.name = COPY.names;
  if (!TEMPLATES.includes(template as Template)) fields.template = "Choose Blank, Ramp, Pendulum or Launcher.";
  if (Object.keys(fields).length > 0) throw validation(fields);
  const doc = templateDocument(template as Template, name);
  const stateHash = initialHash(doc);
  const id = newId();
  await tx(async (db) => {
    await db.query("INSERT INTO scenes (id, project_id, workspace_id, name, status, revision, state_hash, created_at) VALUES ($1,$2,$3,$4,'draft',1,$5,$6)", [id, ctx.params.pid, project.workspaceId, name, stateHash, ctx.now]);
    await db.query("INSERT INTO scene_revisions (scene_id, revision, document, ops, state_hash, kind, created_at) VALUES ($1,1,$2,'[]',$3,'create',$4)", [id, canonicalDocument(doc), stateHash, ctx.now]);
    await db.query("UPDATE projects SET updated_at = $2 WHERE id = $1", [ctx.params.pid, ctx.now]);
    await logActivity(db, project.workspaceId, ctx.user.id, "scene.created", name, ctx.now);
  });
  return { status: 201, json: { scene: { id, name, status: "draft", revision: 1, stateHash } } };
}

async function getProject(ctx: Ctx): Promise<Reply> {
  await projectAccess(ctx.params.pid, ctx.user);
  const scenes = await pool.query<{ id: string; name: string; status: string; revision: number }>("SELECT id, name, status, revision FROM scenes WHERE project_id = $1 ORDER BY created_at, id", [ctx.params.pid]);
  const assets = await pool.query<AssetRow>("SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at, id", [ctx.params.pid]);
  return { status: 200, json: { project: await loadProject(pool, ctx.params.pid), scenes: scenes.rows, assets: assets.rows.map(assetJson) } };
}

export function sceneJson(scene: SceneRow, lab: LabInfo | null): Record<string, unknown> {
  return { id: scene.id, projectId: scene.project_id, name: scene.name, status: scene.status, revision: scene.revision, stateHash: scene.state_hash, lab };
}

async function getScene(ctx: Ctx): Promise<Reply> {
  const { scene } = await sceneAccess(ctx.params.sid, ctx.user);
  const current = await currentDocument(pool, scene.id);
  return { status: 200, json: { scene: sceneJson({ ...scene, revision: current.revision }, await labOf(pool, scene.id)), document: current.doc } };
}

async function getDocument(ctx: Ctx): Promise<Reply> {
  const { scene } = await sceneAccess(ctx.params.sid, ctx.user);
  const current = await currentDocument(pool, scene.id);
  return { status: 200, bytes: Buffer.from(current.text, "utf8"), headers: { "content-type": "application/json; charset=utf-8", "x-revision": String(current.revision), "cache-control": "no-store" } };
}

interface PatchBody {
  baseRevision: number;
  changeId: string;
  ops: Op[];
}

function readPatchBody(body: unknown): PatchBody {
  const record_ = record(body);
  const fields: FieldErrors = {};
  if (!Number.isInteger(record_.baseRevision) || (record_.baseRevision as number) < 1) fields.baseRevision = "Give the revision this change was based on.";
  if (typeof record_.changeId !== "string" || record_.changeId.length < 8 || record_.changeId.length > 80) fields.changeId = "Give a change id.";
  const ops = record_.ops;
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 200) fields.ops = "Give between 1 and 200 ops.";
  else {
    ops.forEach((op, i) => {
      const o = record(op);
      const ok =
        (o.op === "add" && typeof o.object === "object" && o.object !== null) ||
        (o.op === "set" && typeof o.objectId === "string" && typeof o.field === "string") ||
        (o.op === "remove" && typeof o.objectId === "string") ||
        (o.op === "scene" && (o.field === "name" || o.field === "gravity"));
      if (!ok) fields[`ops.${i}`] = "Use add, set, remove or scene with their fields.";
    });
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return record_ as unknown as PatchBody;
}

function validateOps(doc: SceneDocument, ops: readonly Op[], isModelAsset: (id: string) => boolean): FieldErrors {
  const errors: FieldErrors = {};
  let working = doc;
  for (const op of ops) {
    if (op.op === "add") {
      Object.assign(errors, validateNewObject(op.object, new Set(working.objects.map((o) => o.id)), isModelAsset));
    } else if (op.op === "scene") {
      const error = validateSceneValue(op.field, op.value);
      if (error) errors[`scene.${op.field}`] = error;
    } else if (op.op === "set") {
      const object = findObject(working, op.objectId);
      const error = object ? validateSetValue(object, op.field, op.value) : null;
      if (error) errors[`${op.objectId}.${op.field}`] = error === "unknown" ? "That field cannot be changed." : error;
    }
    working = op.op === "set" && findObject(working, op.objectId) === undefined ? working : applyOp(working, op);
  }
  return errors;
}

async function patchScene(ctx: Ctx): Promise<Reply> {
  const { scene, role } = await sceneAccess(ctx.params.sid, ctx.user);
  requireRole(role, CAN_EDIT);
  const body = readPatchBody(ctx.body);
  const requestHash = sha256Hex(canonicalJson({ baseRevision: body.baseRevision, changeId: body.changeId, ops: body.ops }));
  const replay = await replayOf(pool, scene.id, body.changeId, requestHash);
  if (replay) return replay;
  await valkey.ping();
  const result = await tx(async (db) => {
    await db.query("SELECT 1 FROM scenes WHERE id = $1 FOR UPDATE", [scene.id]);
    const again = await replayOf(db, scene.id, body.changeId, requestHash);
    if (again) return { reply: again, removedLeases: [] as string[] };
    const current = await currentDocument(db, scene.id);
    const state = await one<{ restore_revision: number }>(db, "SELECT restore_revision FROM scenes WHERE id = $1", [scene.id]);
    const restoreRevision = state?.restore_revision ?? 0;
    if (body.baseRevision > current.revision) throw validation({ baseRevision: "That revision does not exist yet." });
    const since = body.baseRevision < current.revision ? await db.query<{ keys: string[]; removed: string[] }>("SELECT keys, removed FROM scene_revisions WHERE scene_id = $1 AND revision > $2", [scene.id, body.baseRevision]) : { rows: [] };
    const keysSince = new Set(since.rows.flatMap((r) => r.keys));
    const removedSince = new Set(since.rows.flatMap((r) => r.removed));

    let working = current.doc;
    const addedHere = new Set<string>();
    for (const op of body.ops) {
      if (op.op === "add") addedHere.add(op.object?.id);
      if (op.op === "set" || op.op === "remove") {
        const object = findObject(working, op.objectId);
        if (!object && !addedHere.has(op.objectId)) {
          if (removedSince.has(op.objectId)) {
            throw new ApiError(412, "revision_conflict", "This scene changed elsewhere.", undefined, { currentRevision: current.revision, conflicts: [...keysSince].filter((k) => k.startsWith(`${op.objectId}.`)).sort() });
          }
          throw notFound();
        }
        if (object) {
          const lease = await valkey.get(scene.id, op.objectId);
          if (!lease || lease.userId !== ctx.user.id || lease.fence !== op.fence) throw new ApiError(409, "stale_lock", "Your hold on that object ran out.", undefined, { objectId: op.objectId });
        }
      }
      working = op.op === "set" && !findObject(working, op.objectId) ? working : applyOp(working, op);
    }
    if (body.baseRevision < restoreRevision) {
      throw new ApiError(412, "revision_conflict", "This scene was restored from a checkpoint.", undefined, { currentRevision: current.revision, conflicts: allOpKeys(current.doc, body.ops).sort() });
    }
    const overlap = touchedKeys(current.doc, body.ops).filter((k) => keysSince.has(k));
    if (overlap.length > 0) throw new ApiError(412, "revision_conflict", "This scene changed elsewhere.", undefined, { currentRevision: current.revision, conflicts: overlap.sort() });

    const assetIds = new Set((await db.query<{ id: string }>("SELECT id FROM assets WHERE project_id = $1 AND kind IN ('glb','gltf')", [scene.project_id])).rows.map((r) => r.id));
    const errors = validateOps(current.doc, body.ops, (id) => assetIds.has(id));
    if (Object.keys(errors).length > 0) throw validation(errors);

    const next = body.ops.reduce(applyOp, current.doc);
    const revision = current.revision + 1;
    const stateHash = initialHash(next);
    const changes = changedKeys(current.doc, body.ops);
    await db.query(
      "INSERT INTO scene_revisions (scene_id, revision, document, ops, change_id, request_hash, base_revision, keys, removed, state_hash, kind, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'patch',$11)",
      [scene.id, revision, canonicalDocument(next), JSON.stringify(body.ops), body.changeId, requestHash, body.baseRevision, changes.keys, changes.removed, stateHash, ctx.now],
    );
    await db.query("UPDATE scenes SET revision = $2, name = $3, state_hash = $4 WHERE id = $1", [scene.id, revision, next.name, stateHash]);
    await logActivity(db, scene.workspace_id, ctx.user.id, "scene.edited", next.name, ctx.now);
    return { reply: { status: 200, json: { revision, stateHash } } as Reply, removedLeases: changes.removed };
  });
  if (result.removedLeases.length > 0) await valkey.deleteLocks(scene.id, result.removedLeases);
  notifyScene(scene.id);
  return result.reply;
}

async function replayOf(db: Db, sceneId: string, changeId: string, requestHash: string): Promise<Reply | null> {
  const row = await one<{ revision: number; state_hash: string; request_hash: string }>(db, "SELECT revision, state_hash, request_hash FROM scene_revisions WHERE scene_id = $1 AND change_id = $2", [sceneId, changeId]);
  if (!row) return null;
  if (row.request_hash !== requestHash) throw new ApiError(409, "change_id_reused", "That change id was already used for a different change.");
  return { status: 200, json: { revision: row.revision, stateHash: row.state_hash } };
}

interface VerifyRequest {
  steps: number;
  overrides: Record<string, number>;
}

/** Reads a verify body; `allowed` limits the adjustable keys (a lab's exposed parameters) when given. */
export function readVerify(body: unknown, doc: SceneDocument, allowed: ReadonlySet<string> | null): VerifyRequest {
  const record_ = record(body);
  const errors: FieldErrors = {};
  const steps = record_.steps;
  if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS) errors.steps = COPY.steps;
  const overrides: Record<string, number> = {};
  const params = record_.params === undefined ? {} : record(record_.params);
  for (const [key, value] of Object.entries(params)) {
    const [objectId, param] = [key.slice(0, key.indexOf(".")), key.slice(key.indexOf(".") + 1)];
    const object = findObject(doc, objectId);
    const def = object ? paramDefs(object.kind).find((d) => d.key === param) : undefined;
    if (!def || (allowed && !allowed.has(key))) errors[key] = COPY.unexposed(key);
    else if (typeof value !== "number" || !inRange(value, def)) errors[key] = rangeError(def);
    else overrides[key] = value;
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  return { steps: steps as number, overrides };
}

export async function runVerify(projectId: string, doc: SceneDocument, request: VerifyRequest): Promise<Reply> {
  const bounds = await modelBoundsFor(projectId, doc);
  const simulation = new Simulation(doc, request.overrides, bounds);
  simulation.advance(request.steps);
  return { status: 200, json: { step: simulation.step, stateHash: simulation.hash() } };
}

async function verifyScene(ctx: Ctx): Promise<Reply> {
  const { scene } = await sceneAccess(ctx.params.sid, ctx.user);
  const current = await currentDocument(pool, scene.id);
  return runVerify(scene.project_id, current.doc, readVerify(ctx.body, current.doc, null));
}

interface CheckpointRow {
  id: string;
  label: string;
  revision: number;
  state_hash: string;
  document_sha256: string;
  created_at: Date;
}

const checkpointJson = (c: CheckpointRow): Record<string, unknown> => ({ id: c.id, label: c.label, revision: c.revision, stateHash: c.state_hash, documentSha256: c.document_sha256, createdAt: c.created_at.toISOString() });

async function createCheckpoint(ctx: Ctx): Promise<Reply> {
  const { scene, role } = await sceneAccess(ctx.params.sid, ctx.user);
  requireRole(role, CAN_EDIT);
  await s3.ping();
  const label = text(record(ctx.body).label).trim();
  if (!validName(label)) throw validation({ label: COPY.names });
  const id = newId();
  const created = await tx(async (db) => {
    await db.query("SELECT 1 FROM scenes WHERE id = $1 FOR UPDATE", [scene.id]);
    const current = await currentDocument(db, scene.id);
    const row = await one<CheckpointRow>(
      db,
      `INSERT INTO checkpoints (id, scene_id, label, label_key, revision, state_hash, document_sha256, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (scene_id, label_key) DO NOTHING RETURNING id, label, revision, state_hash, document_sha256, created_at`,
      [id, scene.id, label, label.toLowerCase(), current.revision, initialHash(current.doc), sha256Hex(current.text), ctx.now],
    );
    if (!row) throw new ApiError(409, "checkpoint_name_taken", COPY.checkpointTaken, { label: COPY.checkpointTaken });
    await s3.put(`checkpoints/${scene.id}/${id}.json`, Buffer.from(current.text, "utf8"));
    await db.query("UPDATE scenes SET status = 'checkpointed' WHERE id = $1 AND status = 'draft'", [scene.id]);
    await logActivity(db, scene.workspace_id, ctx.user.id, "checkpoint.created", label, ctx.now);
    return row;
  });
  notifyScene(scene.id);
  return { status: 201, json: { checkpoint: checkpointJson(created) } };
}

async function listCheckpoints(ctx: Ctx): Promise<Reply> {
  const { scene } = await sceneAccess(ctx.params.sid, ctx.user);
  const rows = await pool.query<CheckpointRow>("SELECT id, label, revision, state_hash, document_sha256, created_at FROM checkpoints WHERE scene_id = $1 ORDER BY created_at DESC, id DESC", [scene.id]);
  return { status: 200, json: { checkpoints: rows.rows.map(checkpointJson) } };
}

async function checkpointOf(sceneId: string, checkpointId: string): Promise<CheckpointRow> {
  const row = await one<CheckpointRow>(pool, "SELECT id, label, revision, state_hash, document_sha256, created_at FROM checkpoints WHERE id = $1 AND scene_id = $2", [checkpointId, sceneId]);
  if (!row) throw notFound();
  return row;
}

export async function snapshotBytes(sceneId: string, checkpointId: string): Promise<Uint8Array> {
  const bytes = await s3.get(`checkpoints/${sceneId}/${checkpointId}.json`);
  if (!bytes) throw storageUnavailable();
  return bytes;
}

async function checkpointDocument(ctx: Ctx): Promise<Reply> {
  const { scene } = await sceneAccess(ctx.params.sid, ctx.user);
  await checkpointOf(scene.id, ctx.params.cid);
  return { status: 200, bytes: await snapshotBytes(scene.id, ctx.params.cid), headers: { "content-type": "application/json; charset=utf-8" } };
}

async function restoreCheckpoint(ctx: Ctx): Promise<Reply> {
  const { scene, role } = await sceneAccess(ctx.params.sid, ctx.user);
  requireRole(role, CAN_EDIT);
  const checkpoint = await checkpointOf(scene.id, ctx.params.cid);
  await s3.ping();
  const others = (await valkey.list(scene.id)).filter((lock) => lock.userId !== ctx.user.id);
  if (others.length > 0) {
    const holders = [...new Map(others.map((l) => [l.userId, { userId: l.userId, displayName: l.displayName }])).values()];
    throw new ApiError(409, "locks_held", "Others are editing objects in this scene.", undefined, { holders });
  }
  const snapshot = Buffer.from(await snapshotBytes(scene.id, checkpoint.id)).toString("utf8");
  const doc = JSON.parse(snapshot) as SceneDocument;
  const revision = await tx(async (db) => {
    await db.query("SELECT 1 FROM scenes WHERE id = $1 FOR UPDATE", [scene.id]);
    const current = await currentDocument(db, scene.id);
    const next = current.revision + 1;
    await db.query("INSERT INTO scene_revisions (scene_id, revision, document, ops, state_hash, kind, created_at) VALUES ($1,$2,$3,'[]',$4,'restore',$5)", [scene.id, next, snapshot, checkpoint.state_hash, ctx.now]);
    await db.query("UPDATE scenes SET revision = $2, restore_revision = $2, name = $3, state_hash = $4 WHERE id = $1", [scene.id, next, doc.name, checkpoint.state_hash]);
    await logActivity(db, scene.workspace_id, ctx.user.id, "checkpoint.restored", checkpoint.label, ctx.now);
    return { next, goneObjects: current.doc.objects.filter((o) => !findObject(doc, o.id)).map((o) => o.id) };
  });
  await valkey.deleteLocks(scene.id, revision.goneObjects);
  notifyScene(scene.id);
  return { status: 200, json: { revision: revision.next, stateHash: checkpoint.state_hash } };
}

export function registerSceneRoutes(): void {
  route("GET", "/api/projects/:pid", getProject);
  route("POST", "/api/projects/:pid/scenes", createScene);
  route("GET", "/api/scenes/:sid", getScene);
  route("GET", "/api/scenes/:sid/document", getDocument);
  route("PATCH", "/api/scenes/:sid", patchScene);
  route("POST", "/api/scenes/:sid/verify", verifyScene);
  route("POST", "/api/scenes/:sid/checkpoints", createCheckpoint);
  route("GET", "/api/scenes/:sid/checkpoints", listCheckpoints);
  route("GET", "/api/scenes/:sid/checkpoints/:cid/document", checkpointDocument);
  route("POST", "/api/scenes/:sid/checkpoints/:cid/restore", restoreCheckpoint);
}

