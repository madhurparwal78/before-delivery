import { Router, type Request } from "express";
import { randomBytes } from "node:crypto";
import { query } from "../db";
import { errors, requireAuth, assertNotReadOnly, HttpError, isReadOnly, formatDate, formatDateTime } from "../http";
import { audit } from "../audit";
import { getSceneRow, latestSeq, graphAt, baseGraph, appendBatch, isAppendFailure, callerAuthor, type AuthorInfo } from "./scenes";
import { storage, mailer, killbill } from "../services";
import { graphHash, cloneGraph } from "../../shared/graph";
import type { Graph } from "../../shared/graph-types";
import { publishVersion } from "../realtime";
import { parseLocal } from "./members";

interface VersionRow {
  id: string;
  scene_id: string;
  number: number;
  label: string;
  state: string;
  seq: string;
  created_by_id: string;
  created_by_name: string;
  created_by_kind: string;
  publish_at: Date | null;
  published_at: Date | null;
  created_at: Date;
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function versionById(versionId: string, workspaceId: string): Promise<{ row: VersionRow; sceneWorkspaceId: string }> {
  const res = await query(
    "SELECT v.*, s.workspace_id AS scene_ws, s.name AS scene_name FROM versions v JOIN scenes s ON s.id = v.scene_id WHERE v.id = $1",
    [versionId],
  );
  const row = res.rows[0] as (VersionRow & { scene_ws: string; scene_name: string }) | undefined;
  if (!row || row.scene_ws !== workspaceId) throw errors.notFound();
  return { row, sceneWorkspaceId: row.scene_ws };
}

async function versionJson(row: VersionRow): Promise<Record<string, unknown>> {
  const approvals = await query(
    "SELECT member_id, member_name, at FROM approvals WHERE version_id = $1 ORDER BY at",
    [row.id],
  );
  const scene = await query("SELECT embed_id FROM scenes WHERE id = $1", [row.scene_id]);
  const embedId = (scene.rows[0] as { embed_id: string | null }).embed_id;
  return {
    id: row.id,
    sceneId: row.scene_id,
    number: row.number,
    label: row.label,
    state: row.state,
    seq: Number(row.seq),
    createdBy: { kind: row.created_by_kind, id: row.created_by_id, name: row.created_by_name },
    approvals: (approvals.rows as { member_id: string; member_name: string; at: Date }[]).map((a) => ({
      member: { kind: "member" as const, id: a.member_id, name: a.member_name },
      at: iso(a.at),
    })),
    publishAt: row.publish_at ? iso(row.publish_at) : null,
    publishedAt: row.published_at ? iso(row.published_at) : null,
    embedId: row.state === "published" ? embedId : null,
  };
}

function canManageVersions(role: string): boolean {
  return role === "owner" || role === "editor";
}

async function callerWs(req: Request): Promise<{ ws: string; role: string; timeZone: string }> {
  const caller = req.caller!;
  if (caller.kind === "agent") throw errors.forbidden();
  return { ws: caller.member.workspace_id, role: caller.member.role, timeZone: caller.workspace.time_zone };
}

export const versionsRouter = Router();
versionsRouter.use(requireAuth);

versionsRouter.get("/:sceneId/versions", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const scene = await getSceneRow(req.params.sceneId, ws);
    const rows = await query("SELECT * FROM versions WHERE scene_id = $1 ORDER BY number", [scene.id]);
    const versions = await Promise.all((rows.rows as unknown as VersionRow[]).map(versionJson));
    res.json({ versions });
  } catch (e) {
    next(e);
  }
});

versionsRouter.post("/:sceneId/versions", async (req, res, next) => {
  try {
    const { ws, role } = await callerWs(req);
    const scene = await getSceneRow(req.params.sceneId, ws);
    if (!canManageVersions(role)) throw errors.forbidden();
    const state = (await query("SELECT state FROM subscriptions WHERE workspace_id = $1", [ws])).rows[0] as { state: string };
    if (isReadOnly(state.state)) throw errors.readOnly();
    const label = req.body?.label;
    if (typeof label !== "string" || label.length < 1 || label.length > 60) {
      throw errors.validation({ label: "Label must be 1-60 characters" });
    }
    const latest = await latestSeq(scene.id);
    const { graph } = await graphAt(scene.id, latest);
    const versionId = `ver_${randomBytes(9).toString("hex")}`;
    const numberRes = await query(
      "INSERT INTO versions (id, scene_id, number, label, state, seq, created_by_id, created_by_name, created_by_kind, snapshot_key) SELECT $1,$2, coalesce(max(number),0)+1, $3, 'draft', $4, $5, $6, 'member', $7 FROM versions WHERE scene_id = $2 RETURNING number",
      [versionId, scene.id, label, latest, req.caller!.kind === "member" ? req.caller!.member.id : "", req.caller!.kind === "member" ? req.caller!.member.name : "", "member"],
    );
    const number = (numberRes.rows[0] as { number: number }).number;
    // store snapshot in file storage
    const snapshot = { seq: latest, graph, hash: graphHash(graph) };
    try {
      await storage().put(storage().snapshotKey(ws, scene.id, versionId), Buffer.from(JSON.stringify(snapshot)), "application/json");
    } catch {
      await query("DELETE FROM versions WHERE id = $1", [versionId]);
      throw errors.serviceUnavailable("file_storage");
    }
    audit(req.caller!, "version.saved", { type: "version", id: versionId });
    const row = (await query("SELECT * FROM versions WHERE id = $1", [versionId])).rows[0] as unknown as VersionRow;
    publishVersion(scene.id, await versionJson(row));
    res.status(201).json(await versionJson(row));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Version lifecycle transitions (versionId routes)
// ---------------------------------------------------------------------------

export const versionActionsRouter = Router();
versionActionsRouter.use(requireAuth);

versionActionsRouter.post("/:versionId/submit", async (req, res, next) => {
  try {
    const { ws, role } = await callerWs(req);
    const { row } = await versionById(req.params.versionId, ws);
    if (!canManageVersions(role)) throw errors.forbidden();
    await assertNotReadOnly(ws);
    if (row.state !== "draft") throw errors.conflict("invalid_transition", { from: row.state, to: "in_review" });
    await query("UPDATE versions SET state = 'in_review' WHERE id = $1", [row.id]);
    audit(req.caller!, "version.submitted", { type: "version", id: row.id });
    const fresh = (await query("SELECT * FROM versions WHERE id = $1", [row.id])).rows[0] as unknown as VersionRow;
    publishVersion(row.scene_id, await versionJson(fresh));
    res.json(await versionJson(fresh));
  } catch (e) {
    next(e);
  }
});

versionActionsRouter.post("/:versionId/approve", async (req, res, next) => {
  try {
    const { ws } = await callerWs(req);
    const { row } = await versionById(req.params.versionId, ws);
    // any role may approve, never the version's own creator
    const caller = req.caller!;
    if (caller.kind !== "member") throw errors.forbidden();
    if (caller.member.id === row.created_by_id && row.created_by_kind === "member") throw errors.forbidden();
    await assertNotReadOnly(ws);
    if (row.state !== "in_review") throw errors.conflict("not_in_review");
    const existing = await query("SELECT 1 FROM approvals WHERE version_id = $1 AND member_id = $2", [row.id, caller.member.id]);
    if (existing.rows.length === 0) {
      await query("INSERT INTO approvals (version_id, member_id, member_name) VALUES ($1,$2,$3)", [row.id, caller.member.id, caller.member.name]);
    }
    audit(caller, "version.approved", { type: "version", id: row.id });
    const fresh = (await query("SELECT * FROM versions WHERE id = $1", [row.id])).rows[0] as unknown as VersionRow;
    publishVersion(row.scene_id, await versionJson(fresh));
    res.json(await versionJson(fresh));
  } catch (e) {
    next(e);
  }
});

versionActionsRouter.post("/:versionId/schedule", async (req, res, next) => {
  try {
    const { ws, role, timeZone } = await callerWs(req);
    const { row } = await versionById(req.params.versionId, ws);
    if (!canManageVersions(role)) throw errors.forbidden();
    const state = (await query("SELECT state FROM subscriptions WHERE workspace_id = $1", [ws])).rows[0] as { state: string };
    if (isReadOnly(state.state)) throw errors.readOnly();
    if (row.state !== "in_review") {
      throw errors.conflict("invalid_transition", { from: row.state, to: "scheduled" });
    }
    const approvals = await query(
      "SELECT member_id FROM approvals WHERE version_id = $1 AND member_id != $2",
      [row.id, row.created_by_id],
    );
    if (approvals.rows.length === 0) throw errors.conflict("approval_required");
    const scheduled = await query(
      "SELECT 1 FROM versions WHERE scene_id = $1 AND state = 'scheduled' AND id != $2",
      [row.scene_id, row.id],
    );
    if (scheduled.rows.length > 0) throw errors.conflict("another_version_scheduled");
    const publishAtRaw = req.body?.publishAt;
    if (typeof publishAtRaw !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(publishAtRaw)) {
      throw errors.validation({ publishAt: "Use YYYY-MM-DD HH:mm:ss." });
    }
    const publishAt = parseLocal(publishAtRaw, timeZone);
    if (!publishAt) throw errors.validation({ publishAt: "Use YYYY-MM-DD HH:mm:ss." });
    const now = Date.now();
    if (publishAt.getTime() < now + 5_000 || publishAt.getTime() > now + 365 * 24 * 3600 * 1000) {
      throw errors.validation({ publishAt: "Pick a time between 5 seconds and 365 days from now." });
    }
    // the version's snapshot must be readable from file storage
    const snapshot = await storage().get(storage().snapshotKey(ws, row.scene_id, row.id));
    if (!snapshot) throw errors.serviceUnavailable("file_storage");
    await query("UPDATE versions SET state = 'scheduled', publish_at = $1, scheduled_by = $2 WHERE id = $3", [publishAt, (req.caller as { kind: "member"; member: { id: string } }).member.id, row.id]);
    audit(req.caller!, "version.scheduled", { type: "version", id: row.id });
    const scene = await getSceneRow(row.scene_id, ws);
    const fresh = (await query("SELECT * FROM versions WHERE id = $1", [row.id])).rows[0] as unknown as VersionRow;
    const schedulingMember = req.caller!.kind === "member" ? req.caller!.member : null;
    if (schedulingMember) {
      mailer().send({
        to: [schedulingMember.email],
        subject: `Scheduled: ${scene.name} v${row.number} goes live ${formatDateTime(publishAt, timeZone)}`,
        text: `${scene.name} version ${row.number} is scheduled to go live at ${formatDateTime(publishAt, timeZone)}.\n\nLabel: ${row.label}\n`,
      });
    }
    publishVersion(row.scene_id, await versionJson(fresh));
    res.json(await versionJson(fresh));
  } catch (e) {
    next(e);
  }
});

versionActionsRouter.post("/:versionId/unschedule", async (req, res, next) => {
  try {
    const { ws, role } = await callerWs(req);
    const { row } = await versionById(req.params.versionId, ws);
    if (!canManageVersions(role)) throw errors.forbidden();
    if (row.state !== "scheduled") throw errors.conflict("invalid_transition", { from: row.state, to: "in_review" });
    await query("UPDATE versions SET state = 'in_review', publish_at = NULL WHERE id = $1", [row.id]);
    audit(req.caller!, "version.unscheduled", { type: "version", id: row.id });
    const fresh = (await query("SELECT * FROM versions WHERE id = $1", [row.id])).rows[0] as unknown as VersionRow;
    publishVersion(row.scene_id, await versionJson(fresh));
    res.json(await versionJson(fresh));
  } catch (e) {
    next(e);
  }
});

versionActionsRouter.post("/:versionId/withdraw", async (req, res, next) => {
  try {
    const { ws, role } = await callerWs(req);
    const { row } = await versionById(req.params.versionId, ws);
    if (!canManageVersions(role)) throw errors.forbidden();
    if (row.state !== "published") {
      throw errors.conflict("invalid_transition", { from: row.state, to: "withdrawn" });
    }
    await query("UPDATE versions SET state = 'withdrawn', publish_at = NULL WHERE id = $1", [row.id]);
    audit(req.caller!, "version.withdrawn", { type: "version", id: row.id });
    const fresh = (await query("SELECT * FROM versions WHERE id = $1", [row.id])).rows[0] as unknown as VersionRow;
    publishVersion(row.scene_id, await versionJson(fresh));
    res.json(await versionJson(fresh));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

exportsRouter.post("/:versionId/exports", async (req, res, next) => {
  try {
    const { ws, role } = await callerWs(req);
    const { row } = await versionById(req.params.versionId, ws);
    if (!canManageVersions(role)) throw errors.forbidden();
    await assertNotReadOnly(ws);
    if (row.state !== "published") throw errors.conflict("not_published");
    const snapshotBuf = await storage().get(storage().snapshotKey(ws, row.scene_id, row.id));
    if (!snapshotBuf) throw errors.serviceUnavailable("file_storage");
    const snapshot = JSON.parse(snapshotBuf.toString()) as { graph: Graph };
    const scene = await getSceneRow(row.scene_id, ws);
    const exportId = `exp_${randomBytes(9).toString("hex")}`;
    const { makeZip } = await import("../storage");
    const entries: { name: string; data: Buffer }[] = [
      { name: "scene.json", data: Buffer.from(JSON.stringify({ scene: { name: scene.name }, version: { number: row.number, label: row.label, publishedAt: iso(row.published_at!) }, graph: snapshot.graph })) },
    ];
    const assetIds = collectAssetIds(snapshot.graph);
    for (const assetId of assetIds) {
      const assetRow = await query("SELECT name, content_type FROM assets WHERE id = $1 AND workspace_id = $2", [assetId, ws]);
      if (assetRow.rows.length === 0) continue;
      const a = assetRow.rows[0] as { name: string; content_type: string };
      const data = await storage().get(storage().assetKey(ws, assetId));
      if (!data) throw errors.serviceUnavailable("file_storage");
      const ext = a.content_type === "image/png" ? "png" : a.content_type === "image/jpeg" ? "jpg" : "glb";
      entries.push({ name: `assets/${assetId}.${ext}`, data });
    }
    const viewer = Buffer.from(standaloneViewer());
    entries.push({ name: "viewer.html", data: viewer });
    const zip = makeZip(entries);
    await storage().put(storage().exportKey(ws, exportId), zip, "application/zip");
    await query("INSERT INTO exports (id, version_id, workspace_id, bytes) VALUES ($1,$2,$3,$4)", [exportId, row.id, ws, zip.length]);
    audit(req.caller!, "export.created", { type: "export", id: exportId });
    res.status(201).json({ id: exportId, versionId: row.id, bytes: zip.length });
  } catch (e) {
    next(e);
  }
});

function collectAssetIds(graph: Graph): string[] {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (node.assetId) ids.add(node.assetId);
  }
  return [...ids];
}

function standaloneViewer(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Orrery export viewer</title>
<style>body{margin:0;background:#1c1a17;color:#f2ead9;font-family:system-ui,sans-serif}canvas{display:block}</style>
</head><body>
<div id="info">Loading scene.json…</div>
<canvas id="c"></canvas>
<script type="module">
const res = await fetch('scene.json');
const data = await res.json();
document.getElementById('info').textContent = data.scene.name + ' · v' + data.version.number;
// Minimal software renderer for the exported graph
const canvas = document.getElementById('c');
canvas.width = innerWidth; canvas.height = innerHeight;
const ctx = canvas.getContext('2d');
function draw(t){
  ctx.fillStyle = '#211f1c'; ctx.fillRect(0,0,canvas.width,canvas.height);
  const cx = canvas.width/2, cy = canvas.height/2;
  const yaw = t/4000;
  for (const node of data.graph.nodes){
    if (node.kind !== 'mesh') continue;
    const x3 = node.position[0]*Math.cos(yaw) + node.position[2]*Math.sin(yaw);
    const z3 = -node.position[0]*Math.sin(yaw) + node.position[2]*Math.cos(yaw);
    const s = 60 / (2 + z3*0.3 + 2);
    const px = cx + x3*60, py = cy - node.position[1]*60;
    const size = Math.max(4, Math.min(60, 30*node.scale[0]));
    ctx.beginPath();
    ctx.fillStyle = node.materialLayers[0]?.color ? 'rgb('+node.materialLayers[0].color.map(c=>Math.round(c*255)).join(',')+')' : '#7a8baa';
    ctx.ellipse(px, py, size, size*0.7, 0, 0, Math.PI*2);
    ctx.fill();
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
</script>
</body></html>`;
}

export { versionById, versionJson, iso as versionIso };

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

export const thumbnailRouter = Router();

thumbnailRouter.put("/versions/:versionId/thumbnail", requireAuth, async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (caller.member.role !== "owner" && caller.member.role !== "editor") throw errors.forbidden();
    const ws = caller.member.workspace_id;
    const { row } = await versionById(req.params.versionId!, ws);
    const raw = (req as unknown as { rawBody: Buffer }).rawBody;
    if (!raw || raw.length < 8 || raw[0] !== 0x89 || raw[1] !== 0x50 || raw[2] !== 0x4e || raw[3] !== 0x47) {
      throw errors.unsupportedType();
    }
    if (!(await storage().check())) throw errors.serviceUnavailable("file_storage");
    await storage().put(storage().thumbnailKey(ws, row.scene_id, row.id), raw, "image/png");
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
