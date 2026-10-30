import { Router } from "express";
import { randomBytes } from "node:crypto";
import { query } from "../db";
import { errors, requireAuth, assertNotReadOnly, isReadOnly } from "../http";
import { audit } from "../audit";
import { newReviewToken, hashToken } from "../auth";
import { parseLocal, callerWsShared } from "./billing-shared";

export const reviewLinksRouter = Router();

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function linkById(linkId: string, workspaceId: string): Promise<{ id: string; version_id: string; token: string; expires_at: Date; revoked_at: Date | null; created_by_id: string; created_by_name: string; ws: string }> {
  const res = await query(
    "SELECT l.*, v.scene_id, s.workspace_id AS ws FROM review_links l JOIN versions v ON v.id = l.version_id JOIN scenes s ON s.id = v.scene_id WHERE l.id = $1",
    [linkId],
  );
  const row = res.rows[0] as { id: string; version_id: string; token: string; expires_at: Date; revoked_at: Date | null; created_by_id: string; created_by_name: string; ws: string } | undefined;
  if (!row || row.ws !== workspaceId) throw errors.notFound();
  return row;
}

reviewLinksRouter.get("/versions/:versionId/review-links", requireAuth, async (req, res, next) => {
  try {
    const { ws } = await callerWsShared(req);
    const version = await versionInWorkspace(req.params.versionId!, ws);
    const rows = await query("SELECT * FROM review_links WHERE version_id = $1 ORDER BY created_at", [version.id]);
    const links = rows.rows.map((r) => {
      const row = r as { id: string; token: string; expires_at: Date; revoked_at: Date | null; regenerated_at: Date | null; created_by_id: string; created_by_name: string };
      const status = row.revoked_at ? "revoked" : row.expires_at.getTime() <= Date.now() ? "expired" : "active";
      return {
        id: row.id,
        expiresAt: iso(row.expires_at),
        status,
        createdBy: { kind: "member" as const, id: row.created_by_id, name: row.created_by_name },
      };
    });
    res.json({ links });
  } catch (e) {
    next(e);
  }
});

reviewLinksRouter.post("/versions/:versionId/review-links", requireAuth, async (req, res, next) => {
  try {
    const { ws, role, timeZone } = await callerWsShared(req);
    if (role !== "owner" && role !== "editor") throw errors.forbidden();
    await assertNotReadOnly(ws);
    const version = await versionInWorkspace(req.params.versionId!, ws);
    if (version.state !== "draft" && version.state !== "in_review" && version.state !== "scheduled") {
      throw errors.conflict("version_not_reviewable");
    }
    const wsRow = await query("SELECT review_links_enabled FROM workspaces WHERE id = $1", [ws]);
    if (!(wsRow.rows[0] as { review_links_enabled: boolean }).review_links_enabled) {
      throw errors.conflict("review_links_disabled");
    }
    const expiresAtRaw = req.body?.expiresAt;
    if (typeof expiresAtRaw !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(expiresAtRaw)) {
      throw errors.validation({ expiresAt: "Use YYYY-MM-DD HH:mm:ss." });
    }
    const expiresAt = parseLocal(expiresAtRaw, timeZone);
    if (!expiresAt) throw errors.validation({ expiresAt: "Use YYYY-MM-DD HH:mm:ss." });
    const now = Date.now();
    if (expiresAt.getTime() < now + 10_000 || expiresAt.getTime() > now + 30 * 24 * 3600 * 1000) {
      throw errors.validation({ expiresAt: "Expiry must be between 10 seconds and 30 days from now" });
    }
    const token = newReviewToken();
    const id = `rlk_${randomBytes(9).toString("hex")}`;
    const caller = req.caller as { kind: "member"; member: { id: string; name: string } };
    await query(
      "INSERT INTO review_links (id, version_id, workspace_id, token, expires_at, created_by_id, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, version.id, ws, token, expiresAt, caller.member.id, caller.member.name],
    );
    audit(req.caller!, "review_link.created", { type: "review_link", id });
    res.status(201).json({ id, token, url: `/review/${token}`, expiresAt: iso(expiresAt) });
  } catch (e) {
    next(e);
  }
});

reviewLinksRouter.post("/review-links/:linkId/regenerate", requireAuth, async (req, res, next) => {
  try {
    const { ws, role } = await callerWsShared(req);
    if (role !== "owner" && role !== "editor") throw errors.forbidden();
    await assertNotReadOnly(ws);
    const link = await linkById(req.params.linkId!, ws);
    if (link.revoked_at) throw errors.notFound();
    const token = newReviewToken();
    await query("UPDATE review_links SET token = $1, regenerated_at = now() WHERE id = $2", [token, link.id]);
    audit(req.caller!, "review_link.regenerated", { type: "review_link", id: link.id });
    const fresh = (await query("SELECT * FROM review_links WHERE id = $1", [link.id])).rows[0] as { expires_at: Date };
    res.json({ id: link.id, token, url: `/review/${token}`, expiresAt: iso(fresh.expires_at) });
  } catch (e) {
    next(e);
  }
});

reviewLinksRouter.delete("/review-links/:linkId", requireAuth, async (req, res, next) => {
  try {
    const { ws, role } = await callerWsShared(req);
    if (role !== "owner" && role !== "editor") throw errors.forbidden();
    const link = await linkById(req.params.linkId!, ws);
    await query("UPDATE review_links SET revoked_at = now() WHERE id = $1", [link.id]);
    audit(req.caller!, "review_link.revoked", { type: "review_link", id: link.id });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

async function versionInWorkspace(versionId: string, ws: string): Promise<{ id: string; scene_id: string; state: string; number: number; label: string }> {
  const res = await query(
    "SELECT v.id, v.scene_id, v.state, v.number, v.label, s.workspace_id AS ws FROM versions v JOIN scenes s ON s.id = v.scene_id WHERE v.id = $1",
    [versionId],
  );
  const row = res.rows[0] as { id: string; scene_id: string; state: string; number: number; label: string; ws: string } | undefined;
  if (!row || row.ws !== ws) throw errors.notFound();
  return row;
}

// ---------------------------------------------------------------------------
// Public review page data
// ---------------------------------------------------------------------------

export const reviewPublicRouter = Router();

reviewPublicRouter.get("/review/:token", async (req, res, next) => {
  try {
    const token = req.params.token;
    const res2 = await query(
      `SELECT l.id, l.token, l.expires_at, l.revoked_at, l.regenerated_at, l.created_at AS link_created,
              v.id AS version_id, v.number, v.label, v.state, v.scene_id,
              s.name AS scene_name, s.workspace_id, w.review_links_enabled
       FROM review_links l
       JOIN versions v ON v.id = l.version_id
       JOIN scenes s ON s.id = v.scene_id
       JOIN workspaces w ON w.id = s.workspace_id
       WHERE l.token = $1`,
      [token],
    );
    const row = res2.rows[0] as {
      id: string; token: string; expires_at: Date; revoked_at: Date | null; regenerated_at: Date | null; link_created: Date;
      version_id: string; number: number; label: string; state: string; scene_id: string; scene_name: string; workspace_id: string; review_links_enabled: boolean;
    } | undefined;
    if (!row || row.revoked_at) throw errors.notFound();
    if (!row.review_links_enabled) throw errors.notFound();
    if (row.state !== "draft" && row.state !== "in_review" && row.state !== "scheduled") throw errors.notFound();
    if (row.expires_at.getTime() <= Date.now()) throw new (await import("../http")).HttpError(410, { error: "link_expired" });
    const snapshot = await (await import("../services")).storage().get(
      (await import("../services")).storage().snapshotKey(row.workspace_id, row.scene_id, row.version_id),
    );
    if (!snapshot) throw errors.serviceUnavailable("file_storage");
    const parsed = JSON.parse(snapshot.toString()) as { graph: unknown };
    res.json({
      scene: { name: row.scene_name },
      version: { number: row.number, label: row.label, state: row.state },
      graph: parsed.graph,
    });
  } catch (e) {
    next(e);
  }
});

reviewPublicRouter.all("/review/:token", (req, res) => {
  res.status(405).json({ error: "read_only" });
});
