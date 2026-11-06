// Scenes, the operation log, locks, presence, the event stream, assets and comments.
import type { Asset, Author, Comment } from "../../shared/api-types.js";
import { isoSecond } from "../../shared/format.js";
import { graphHash, isName, isRecord, parseBatch, starterGraph, type Graph } from "../../shared/graph.js";
import { authorOf, type Caller } from "../auth.js";
import { audit } from "../audit.js";
import { one, pool, rows, transaction } from "../db.js";
import { conflict, invalid, locked, notFound, unsupportedType } from "../errors.js";
import { bytes, json, noContent, route } from "../http.js";
import { announce, watch } from "../events.js";
import { authorize } from "../domain/permissions.js";
import { applyBatch, graphAt, loadScene, opRowToOp, redo, restore, undo, type OpRow, type SceneRow } from "../domain/history.js";
import { claimOne, heartbeat, listLocks, refreshLocks, release, takeover } from "../domain/locks.js";
import { assertWritable } from "../domain/subscription.js";
import { checkUpload, parseMultipart } from "../domain/uploads.js";
import { insert, list, pbDate, quote, update, type PbRecord } from "../services/pocketbase.js";
import { getObject, keys, putObject } from "../services/storage.js";
import { can } from "../../shared/permissions.js";
import { bodyOf, newId } from "./account.js";

const nodeExists = (graph: Graph, id: unknown): id is string => typeof id === "string" && graph.nodes.some((n) => n.id === id);

route("GET", "/api/scenes", async ({ caller }) => {
  authorize(caller, "scene.read");
  const scenes = await rows<{ id: string; name: string; latest_seq: number; updated_at: Date; published: number | null }>(pool,
    `SELECT s.id, s.name, s.latest_seq, s.updated_at,
       (SELECT max(v.number) FROM versions v WHERE v.scene_id = s.id AND v.state = 'published') AS published
     FROM scenes s WHERE s.workspace_id = $1 ORDER BY s.updated_at DESC, s.id`, [caller.workspaceId]);
  return json(200, {
    scenes: scenes.map((s) => ({ id: s.id, name: s.name, latestSeq: s.latest_seq, updatedAt: isoSecond(s.updated_at), publishedVersion: s.published })),
  });
});

route("POST", "/api/scenes", async (ctx) => {
  const { caller } = ctx;
  authorize(caller, "scene.create");
  await assertWritable(caller.workspaceId);
  const body = bodyOf(ctx);
  if (!isName(body.name)) throw invalid({ name: "Use 1 to 80 characters" });
  const id = newId("sc");
  const graph = JSON.stringify(starterGraph());
  await transaction(async (client) => {
    await client.query("INSERT INTO scenes (id, workspace_id, name, base_graph, graph, created_at, updated_at) VALUES ($1, $2, $3, $4, $4, now(), now())",
      [id, caller.workspaceId, body.name, graph]);
    await audit(client, caller.workspaceId, authorOf(caller), "scene.created", { type: "scene", id });
  });
  return json(201, { id, name: body.name, latestSeq: 0 });
});

async function readableScene(caller: Caller, sceneId: string): Promise<SceneRow> {
  const scene = await loadScene(pool, caller.workspaceId, sceneId);
  authorize(caller, "scene.read");
  return scene;
}

async function editableScene(caller: Caller, sceneId: string): Promise<SceneRow> {
  const scene = await loadScene(pool, caller.workspaceId, sceneId);
  authorize(caller, "scene.edit");
  await assertWritable(caller.workspaceId);
  return scene;
}

route("GET", "/api/scenes/:sceneId", async ({ caller, params }) => {
  const scene = await readableScene(caller, params.sceneId);
  return json(200, { id: scene.id, name: scene.name, latestSeq: scene.latest_seq, graph: scene.graph, hash: graphHash(scene.graph) });
});

route("GET", "/api/scenes/:sceneId/graph", async ({ caller, params, query }) => {
  const scene = await readableScene(caller, params.sceneId);
  const at = Number(query.get("at") ?? scene.latest_seq);
  if (!Number.isInteger(at) || at < 0 || at > scene.latest_seq) throw invalid({ at: `Use an operation number from 0 to ${scene.latest_seq}` });
  const graph = await graphAt(scene, at);
  return json(200, { seq: at, graph, hash: graphHash(graph) });
});

route("GET", "/api/scenes/:sceneId/ops", async ({ caller, params, query }) => {
  const scene = await readableScene(caller, params.sceneId);
  const after = Number(query.get("after") ?? "0");
  const limit = Number(query.get("limit") ?? "500");
  const errors: Record<string, string> = {};
  if (!Number.isInteger(after) || after < 0) errors.after = "Use a whole number from 0";
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) errors.limit = "Use a whole number from 1 to 1000";
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const log = await rows<OpRow>(pool, "SELECT * FROM ops WHERE scene_id = $1 AND seq > $2 ORDER BY seq LIMIT $3", [scene.id, after, limit]);
  return json(200, { ops: log.map(opRowToOp), latestSeq: scene.latest_seq });
});

/** Model assets named by node.add operations must exist in the caller's workspace; others answer not found. */
async function checkAssetReferences(caller: Caller, body: unknown): Promise<Map<string, string>> {
  const kinds = new Map<string, string>();
  if (!isRecord(body) || !Array.isArray(body.ops)) return kinds;
  for (const raw of body.ops) {
    const assetId = isRecord(raw) && raw.type === "node.add" && isRecord(raw.payload) && isRecord(raw.payload.node) ? raw.payload.node.assetId : null;
    if (typeof assetId !== "string") continue;
    const asset = await one<{ kind: string }>(pool, "SELECT kind FROM assets WHERE id = $1 AND workspace_id = $2", [assetId, caller.workspaceId]);
    if (!asset) throw notFound();
    kinds.set(assetId, asset.kind);
  }
  return kinds;
}

/** Nodes an unparseable batch still names, so a lock conflict answers before validation. */
function rawNamedNodes(graph: Graph, body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.ops)) return [];
  return body.ops.flatMap((raw) => {
    if (!isRecord(raw) || raw.type === "node.add" || !isRecord(raw.payload)) return [];
    const id = raw.payload.id ?? raw.payload.nodeId;
    return nodeExists(graph, id) ? [id] : [];
  });
}

async function refuseIfHeld(scene: SceneRow, nodes: string[], author: Author): Promise<void> {
  const held = await listLocks(scene.id);
  for (const node of nodes) {
    const lock = held.find((l) => l.nodeId === node);
    if (lock && !(lock.holder.kind === author.kind && lock.holder.id === author.id)) throw locked(node, lock.holder);
  }
}

route("POST", "/api/scenes/:sceneId/ops", async (ctx) => {
  const scene = await loadScene(pool, ctx.caller.workspaceId, ctx.params.sceneId);
  const body = ctx.body();
  const assetKinds = await checkAssetReferences(ctx.caller, body);
  authorize(ctx.caller, "scene.edit");
  await assertWritable(ctx.caller.workspaceId);
  const author = authorOf(ctx.caller);
  const parsed = parseBatch(body);
  if ("errors" in parsed) {
    await refuseIfHeld(scene, rawNamedNodes(scene.graph, body), author);
    throw invalid(parsed.errors);
  }
  for (const [i, op] of parsed.ops.entries()) {
    if (op.type === "node.add" && op.payload.node.assetId && assetKinds.get(op.payload.node.assetId) !== "model") {
      throw invalid({ [`ops[${i}].payload.node.assetId`]: "Use a model asset" });
    }
  }
  return json(201, await applyBatch(scene, author, parsed.ops));
});

route("POST", "/api/scenes/:sceneId/undo", async ({ caller, params }) => {
  const scene = await editableScene(caller, params.sceneId);
  return json(201, await undo(scene, authorOf(caller)));
});

route("POST", "/api/scenes/:sceneId/redo", async ({ caller, params }) => {
  const scene = await editableScene(caller, params.sceneId);
  return json(201, await redo(scene, authorOf(caller)));
});

route("POST", "/api/scenes/:sceneId/restore", async (ctx) => {
  const { caller } = ctx;
  const scene = await editableScene(caller, ctx.params.sceneId);
  const toSeq = bodyOf(ctx).toSeq;
  if (typeof toSeq !== "number" || !Number.isInteger(toSeq) || toSeq < 0 || toSeq >= scene.latest_seq) {
    throw invalid({ toSeq: `Use an operation number from 0 to ${scene.latest_seq - 1}` });
  }
  const result = await restore(scene, authorOf(caller), toSeq);
  await audit(pool, caller.workspaceId, authorOf(caller), "scene.restored", { type: "scene", id: scene.id });
  return json(201, { ...result, restoredTo: toSeq });
});

route("GET", "/api/scenes/:sceneId/events", async ({ caller, params, res }) => {
  const scene = await readableScene(caller, params.sceneId);
  watch(scene.id, res);
  return null;
});

route("POST", "/api/scenes/:sceneId/presence", async (ctx) => {
  const { caller } = ctx;
  const scene = await loadScene(pool, caller.workspaceId, ctx.params.sceneId);
  const body = bodyOf(ctx);
  if (body.selection !== null && body.selection !== undefined && !nodeExists(scene.graph, body.selection)) throw notFound();
  authorize(caller, "presence");
  const cursor = body.cursor;
  if (!Array.isArray(cursor) || cursor.length !== 2 || !cursor.every((c) => typeof c === "number" && c >= 0 && c <= 1)) {
    throw invalid({ cursor: "Use two numbers from 0 to 1" });
  }
  const author = authorOf(caller);
  await heartbeat(caller.workspaceId, scene.id, author, typeof body.selection === "string" ? body.selection : null, [Number(cursor[0]), Number(cursor[1])]);
  if (can(caller, "scene.edit")) await refreshLocks(scene.id, author);
  await announce(scene.id, "presence");
  return noContent();
});

route("GET", "/api/scenes/:sceneId/locks", async ({ caller, params }) => {
  const scene = await readableScene(caller, params.sceneId);
  return json(200, { locks: await listLocks(scene.id) });
});

route("POST", "/api/scenes/:sceneId/locks", async (ctx) => {
  const { caller } = ctx;
  const scene = await loadScene(pool, caller.workspaceId, ctx.params.sceneId);
  const nodeId = bodyOf(ctx).nodeId;
  if (!nodeExists(scene.graph, nodeId)) throw notFound();
  authorize(caller, "scene.edit");
  await assertWritable(caller.workspaceId);
  const lock = await claimOne(caller.workspaceId, scene.id, nodeId, authorOf(caller));
  await refreshLocks(scene.id, authorOf(caller));
  await announce(scene.id, "lock");
  return json(200, { lock });
});

route("DELETE", "/api/scenes/:sceneId/locks/:nodeId", async ({ caller, params }) => {
  const scene = await loadScene(pool, caller.workspaceId, params.sceneId);
  if (!nodeExists(scene.graph, params.nodeId)) throw notFound();
  authorize(caller, "scene.edit");
  if (!(await release(scene.id, params.nodeId, authorOf(caller)))) throw conflict("not_lock_holder");
  await announce(scene.id, "lock");
  return noContent();
});

route("POST", "/api/scenes/:sceneId/locks/:nodeId/takeover", async ({ caller, params }) => {
  const scene = await loadScene(pool, caller.workspaceId, params.sceneId);
  if (!nodeExists(scene.graph, params.nodeId)) throw notFound();
  authorize(caller, "scene.edit");
  await assertWritable(caller.workspaceId);
  const result = await takeover(caller.workspaceId, scene.id, params.nodeId, authorOf(caller));
  await announce(scene.id, "lock");
  return json(200, result);
});

// --- Assets ----------------------------------------------------------------------------------------------------

interface AssetRow { id: string; kind: "model" | "texture"; name: string; bytes: number; content_type: string; uploaded_by_kind: "member" | "agent"; uploaded_by_id: string; uploaded_by_name: string }

const assetOut = (a: AssetRow): Asset => ({
  id: a.id, kind: a.kind, name: a.name, bytes: a.bytes, contentType: a.content_type,
  uploadedBy: { kind: a.uploaded_by_kind, id: a.uploaded_by_id, name: a.uploaded_by_name },
});

route("POST", "/api/assets", async (ctx) => {
  const { caller } = ctx;
  authorize(caller, "asset.upload");
  await assertWritable(caller.workspaceId);
  const { fields, file } = parseMultipart(ctx.headers["content-type"], ctx.raw);
  if (!file) throw invalid({ file: "Choose a file" });
  const checked = checkUpload(fields.kind, file.name, file.bytes);
  const id = newId("asset");
  await putObject(keys.asset(caller.workspaceId, id), file.bytes, checked.contentType);
  const author = authorOf(caller);
  const asset = await transaction(async (client) => {
    const [row] = await rows<AssetRow>(client,
      `INSERT INTO assets (id, workspace_id, kind, name, bytes, content_type, uploaded_by_kind, uploaded_by_id, uploaded_by_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now()) RETURNING *`,
      [id, caller.workspaceId, checked.kind, checked.name, file.bytes.length, checked.contentType, author.kind, author.id, author.name]);
    await audit(client, caller.workspaceId, author, "asset.uploaded", { type: "asset", id });
    return row;
  });
  const { uploadedBy: _, ...shown } = assetOut(asset);
  return json(201, shown);
}, { limit: 20_100_000 });

route("GET", "/api/assets", async ({ caller }) => {
  authorize(caller, "scene.read");
  const assets = await rows<AssetRow>(pool, "SELECT * FROM assets WHERE workspace_id = $1 ORDER BY created_at DESC, id", [caller.workspaceId]);
  return json(200, { assets: assets.map(assetOut) });
});

route("GET", "/api/assets/:assetId/file", async ({ caller, params }) => {
  const asset = await one<AssetRow>(pool, "SELECT * FROM assets WHERE id = $1 AND workspace_id = $2", [params.assetId, caller.workspaceId]);
  if (!asset) throw notFound();
  authorize(caller, "scene.read");
  const file = await getObject(keys.asset(caller.workspaceId, asset.id));
  if (!file) throw notFound();
  return bytes(file, asset.content_type, { "Cache-Control": "private, max-age=3600" });
});

route("PUT", "/api/versions/:versionId/thumbnail", async (ctx) => {
  const { caller } = ctx;
  const version = await one<{ id: string; scene_id: string }>(pool, "SELECT id, scene_id FROM versions WHERE id = $1 AND workspace_id = $2", [ctx.params.versionId, caller.workspaceId]);
  if (!version) throw notFound();
  authorize(caller, "asset.upload");
  await assertWritable(caller.workspaceId);
  if (!ctx.raw.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw unsupportedType();
  await putObject(keys.thumbnail(caller.workspaceId, version.scene_id, version.id), ctx.raw, "image/png");
  await pool.query("UPDATE versions SET has_thumbnail = true WHERE id = $1", [version.id]);
  return noContent();
});

// --- Comments --------------------------------------------------------------------------------------------------

async function memberNames(workspaceId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const found = await rows<{ id: string; name: string }>(pool, "SELECT id, name FROM members WHERE workspace_id = $1 AND id = ANY($2)", [workspaceId, ids]);
  return new Map(found.map((m) => [m.id, m.name]));
}

async function commentOut(record: PbRecord, workspaceId: string): Promise<Comment> {
  const mentionIds = Array.isArray(record.mentions) ? record.mentions.filter((m): m is string => typeof m === "string") : [];
  const names = await memberNames(workspaceId, mentionIds);
  return {
    id: String(record.commentId), nodeId: String(record.node), body: String(record.body),
    author: { kind: "member", id: String(record.authorId), name: String(record.authorName) },
    mentions: mentionIds.map((id) => ({ id, name: names.get(id) ?? "" })), resolved: record.resolved === true,
    createdAt: isoSecond(pbDate(record.created)),
  };
}

route("GET", "/api/scenes/:sceneId/comments", async ({ caller, params }) => {
  const scene = await readableScene(caller, params.sceneId);
  const records = await list("comments", `scene=${quote(scene.id)}`);
  return json(200, { comments: await Promise.all(records.map((r) => commentOut(r, caller.workspaceId))) });
});

route("POST", "/api/scenes/:sceneId/comments", async (ctx) => {
  const { caller } = ctx;
  const scene = await loadScene(pool, caller.workspaceId, ctx.params.sceneId);
  const body = bodyOf(ctx);
  if (!nodeExists(scene.graph, body.nodeId)) throw notFound();
  const mentions = Array.isArray(body.mentions) ? body.mentions : [];
  if (!mentions.every((m): m is string => typeof m === "string")) throw notFound();
  const active = await rows<{ id: string }>(pool, "SELECT id FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND id = ANY($2)", [caller.workspaceId, mentions]);
  if (active.length !== new Set(mentions).size) throw notFound();
  authorize(caller, "comment");
  await assertWritable(caller.workspaceId);
  if (typeof body.body !== "string" || body.body.trim() === "" || [...body.body].length > 2000) throw invalid({ body: "Use 1 to 2000 characters" });
  if (!Array.isArray(body.mentions)) throw invalid({ mentions: "Send a list of member IDs" });
  const commentId = newId("cmt");
  const record = await insert("comments", {
    workspace: caller.workspaceId, scene: scene.id, commentId, node: body.nodeId, body: body.body,
    authorId: caller.id, authorName: caller.name, mentions: [...new Set(mentions)], resolved: false,
  });
  await audit(pool, caller.workspaceId, authorOf(caller), "comment.posted", { type: "comment", id: commentId });
  const comment = await commentOut(record, caller.workspaceId);
  await announce(scene.id, "comment", { data: comment });
  return json(201, comment);
});

route("PATCH", "/api/comments/:commentId", async (ctx) => {
  const { caller } = ctx;
  const [record] = await list("comments", `commentId=${quote(ctx.params.commentId)} && workspace=${quote(caller.workspaceId)}`);
  if (!record) throw notFound();
  authorize(caller, "comment");
  await assertWritable(caller.workspaceId);
  const resolved = bodyOf(ctx).resolved;
  if (typeof resolved !== "boolean") throw invalid({ resolved: "Must be true or false" });
  const updated = await update("comments", record.id, { resolved });
  if (!updated) throw notFound();
  await audit(pool, caller.workspaceId, authorOf(caller), resolved ? "comment.resolved" : "comment.reopened", { type: "comment", id: String(record.commentId) });
  const comment = await commentOut(updated, caller.workspaceId);
  await announce(String(record.scene), "comment", { data: comment });
  return json(200, comment);
});

route("GET", "/api/scenes/:sceneId/mentionable", async ({ caller, params, query }) => {
  const scene = await loadScene(pool, caller.workspaceId, params.sceneId);
  authorize(caller, "workspace.read");
  const q = query.get("q") ?? "";
  const members = await rows<{ id: string; name: string; role: string }>(pool,
    `SELECT id, name, role FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND name ILIKE $2 ORDER BY name, id LIMIT 20`,
    [scene.workspace_id, `%${q.replace(/[\\%_]/g, "\\$&")}%`]);
  return json(200, { members });
});
