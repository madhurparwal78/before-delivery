import type { PublicRoadmap } from "../../shared/api.js";
import { monthLabel } from "../../shared/months.js";
import { config } from "../config.js";
import { db, type Queryable } from "../db.js";
import { loadFeatures } from "../domain/features.js";
import { linkWindow, newShareToken, shareLinkStatus, toShareLink, type ShareLinkRow } from "../domain/shareLinks.js";
import { ApiError, conflict, notFound } from "../http/errors.js";
import { H, member, open, type MemberCtx, type Router } from "../http/router.js";
import { Fields } from "../http/validate.js";
import { audit, releaseRows, toRelease } from "./records.js";

export const PUBLIC_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
const LINK_COLUMNS = "id, token, created_at, expires_in_seconds, expires_at, revoked_at";

async function linkOf(ctx: MemberCtx): Promise<ShareLinkRow> {
  const [row] = await db.query<ShareLinkRow>(`SELECT ${LINK_COLUMNS} FROM share_links WHERE id = $1 AND workspace_id = $2`, [ctx.params.id ?? "", ctx.session.workspace.id]);
  if (!row) throw notFound();
  return row;
}

/** The workspace behind a share token while the link is active, else null. */
export async function activeLinkWorkspace(token: string): Promise<string | null> {
  const [row] = await db.query<ShareLinkRow & { workspace_id: string }>(`SELECT ${LINK_COLUMNS}, workspace_id FROM share_links WHERE token = $1`, [token]);
  return row && shareLinkStatus(row, Date.now()) === "active" ? row.workspace_id : null;
}

/** Only public releases, with feature name, public description, release name and target month. */
async function publicRoadmap(q: Queryable, workspaceId: string): Promise<PublicRoadmap> {
  const features = await loadFeatures(q, workspaceId);
  const columns = new Map<string, PublicRoadmap["columns"][number]["releases"]>();
  for (const release of (await releaseRows(q, workspaceId)).map(toRelease).filter((r) => r.isPublic)) {
    const shown = release.featureIds.map((id) => features.summary(id)).filter((f) => f.status !== "archived");
    columns.set(release.targetMonth, [...(columns.get(release.targetMonth) ?? []), {
      name: release.name,
      targetMonth: release.targetMonth,
      features: shown.map((f) => ({ name: f.name, publicDescription: f.publicDescription })),
    }]);
  }
  return {
    columns: [...columns.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, releases]) => ({ month, label: monthLabel(month), releases })),
  };
}

export function shareLinkRoutes(router: Router): void {
  router.add("/api/roadmap/share-links", {
    GET: member({
      roles: H,
      handle: async (ctx) => {
        const rows = await db.query<ShareLinkRow>(`SELECT ${LINK_COLUMNS} FROM share_links WHERE workspace_id = $1 ORDER BY id DESC`, [ctx.session.workspace.id]);
        const now = Date.now();
        return { status: 200, json: { shareLinks: rows.map((r) => toShareLink(r, config.baseUrl, now)) } };
      },
    }),
    POST: member({
      roles: H,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const lifetime = fields.raw("expiresInSeconds") === undefined || fields.raw("expiresInSeconds") === null
          ? null
          : fields.integer("expiresInSeconds", 30, 31_536_000, "Lifetime must be a whole number of seconds from 30 to 31536000.");
        fields.check();
        const now = Date.now();
        const window = linkWindow(lifetime, now);
        const [row] = await db.query<ShareLinkRow>(
          `INSERT INTO share_links (workspace_id, token, created_at, expires_in_seconds, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING ${LINK_COLUMNS}`,
          [ws, newShareToken(), window.createdAt, lifetime, window.expiresAt],
        );
        await audit(db, ctx, ws, "share_link.created", row.id, { expiresInSeconds: lifetime });
        return { status: 201, json: { shareLink: toShareLink(row, config.baseUrl, now) } };
      },
    }),
  });

  router.add("/api/roadmap/share-links/:id/regenerate", {
    POST: member({
      roles: H,
      load: linkOf,
      handle: async (ctx, link) => {
        const now = Date.now();
        const window = linkWindow(link.expires_in_seconds, now);
        const [row] = await db.query<ShareLinkRow>(
          `UPDATE share_links SET token = $2, created_at = $3, expires_at = $4 WHERE id = $1 AND revoked_at IS NULL RETURNING ${LINK_COLUMNS}`,
          [link.id, newShareToken(), window.createdAt, window.expiresAt],
        );
        if (!row) throw conflict("link_revoked", "A revoked link stays revoked.");
        await audit(db, ctx, ctx.session.workspace.id, "share_link.regenerated", link.id);
        return { status: 200, json: { shareLink: toShareLink(row, config.baseUrl, now) } };
      },
    }),
  });

  router.add("/api/roadmap/share-links/:id", {
    DELETE: member({
      roles: H,
      load: linkOf,
      handle: async (ctx, link) => {
        await db.query("UPDATE share_links SET revoked_at = coalesce(revoked_at, now_s()) WHERE id = $1", [link.id]);
        await audit(db, ctx, ctx.session.workspace.id, "share_link.revoked", link.id);
        return { status: 204 };
      },
    }),
  });

  router.add("/api/public/roadmap/:token", {
    GET: open({
      body: "none",
      handle: async (ctx) => {
        const workspaceId = await activeLinkWorkspace(ctx.params.token ?? "");
        if (workspaceId === null) throw new ApiError(404, "link_inactive", "This roadmap link is no longer active.");
        return { status: 200, json: await publicRoadmap(db, workspaceId) };
      },
    }),
  }, PUBLIC_HEADERS);
}
