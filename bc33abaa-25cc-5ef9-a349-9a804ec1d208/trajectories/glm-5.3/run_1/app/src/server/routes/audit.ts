import { Router } from "express";
import { query } from "../db";
import { errors, requireAuth } from "../http";
import { storage } from "../services";

export const auditRouter = Router();
auditRouter.use(requireAuth);

function canReadAudit(role: string): boolean {
  return role === "owner" || role === "admin";
}

auditRouter.get("/", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (!canReadAudit(caller.member.role)) throw errors.forbidden();
    const ws = caller.member.workspace_id;
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 100, 1), 500);
    const rows = await query("SELECT * FROM audit WHERE workspace_id = $1 ORDER BY at DESC, id DESC LIMIT $2", [ws, limit]);
    res.json({
      entries: rows.rows.map((r) => {
        const row = r as { id: string; at: Date; actor_kind: string; actor_id: string; actor_name: string; action: string; target_type: string; target_id: string };
        return {
          id: String(row.id),
          at: row.at.toISOString().replace(/\.\d{3}Z$/, "Z"),
          actor: { kind: row.actor_kind, id: row.actor_id, name: row.actor_name },
          action: row.action,
          target: { type: row.target_type, id: row.target_id },
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Export download
// ---------------------------------------------------------------------------

export const exportDownloadRouter = Router();
exportDownloadRouter.use(requireAuth);

exportDownloadRouter.get("/exports/:exportId", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const row = (await query("SELECT * FROM exports WHERE workspace_id = $1 AND id = $2", [ws, req.params.exportId])).rows[0] as { bytes: number } | undefined;
    if (!row) throw errors.notFound();
    const data = await storage().get(storage().exportKey(ws, req.params.exportId));
    if (!data) throw errors.notFound();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="export.zip"`);
    res.send(data);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Public embed data
// ---------------------------------------------------------------------------

export const embedPublicRouter = Router();

embedPublicRouter.get("/embed/:embedId", async (req, res, next) => {
  try {
    const res2 = await query(
      `SELECT s.embed_id, s.name AS scene_name, s.workspace_id, v.number, v.label, v.published_at, sub.state
       FROM scenes s JOIN versions v ON v.scene_id = s.id AND v.state = 'published'
       JOIN subscriptions sub ON sub.workspace_id = s.workspace_id
       WHERE s.embed_id = $1
       ORDER BY v.number DESC LIMIT 1`,
      [req.params.embedId],
    );
    const row = res2.rows[0] as { embed_id: string; scene_name: string; workspace_id: string; number: number; label: string; published_at: Date; state: string } | undefined;
    if (!row) throw errors.notFound();
    if (row.state === "cancelled") throw errors.gone();
    const payload = await storage().get(storage().publishedKey(row.workspace_id, row.embed_id));
    if (!payload) throw errors.gone();
    res.json(JSON.parse(payload.toString()));
  } catch (e) {
    next(e);
  }
});

embedPublicRouter.get("/embed/:embedId/assets/:assetId", async (req, res, next) => {
  try {
    const res2 = await query(
      `SELECT s.embed_id, s.workspace_id, v.number
       FROM scenes s JOIN versions v ON v.scene_id = s.id AND v.state = 'published'
       WHERE s.embed_id = $1 ORDER BY v.number DESC LIMIT 1`,
      [req.params.embedId],
    );
    const scene = res2.rows[0] as { embed_id: string; workspace_id: string; number: number } | undefined;
    if (!scene) throw errors.notFound();
    const payload = await storage().get(storage().publishedKey(scene.workspace_id, scene.embed_id));
    if (!payload) throw errors.notFound();
    const graph = (JSON.parse(payload.toString()) as { graph: { nodes: { assetId: string | null }[] } }).graph;
    const referenced = graph.nodes.some((n) => n.assetId === req.params.assetId);
    if (!referenced) throw errors.notFound();
    const assetRow = (await query("SELECT content_type FROM assets WHERE workspace_id = $1 AND id = $2", [scene.workspace_id, req.params.assetId])).rows[0] as { content_type: string } | undefined;
    if (!assetRow) throw errors.notFound();
    const data = await storage().get(storage().assetKey(scene.workspace_id, req.params.assetId));
    if (!data) throw errors.notFound();
    res.setHeader("Content-Type", assetRow.content_type);
    res.send(data);
  } catch (e) {
    next(e);
  }
});
