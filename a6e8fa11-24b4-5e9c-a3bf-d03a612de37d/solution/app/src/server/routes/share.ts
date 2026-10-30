// Read-only share links: unguessable, expiring, revocable; the share view carries values, formats and
// charts only — no inputs, ids, member names or sequence numbers.
import { randomUUID } from "node:crypto";
import { newToken } from "../auth.js";
import { type Queryable, tx } from "../db.js";
import { ApiError, invalid, notFound } from "../errors.js";
import { jsonBody, member, open } from "../http.js";
import { requireRole } from "../rules/roles.js";
import { type Services } from "../services/index.js";
import { type WorkbookRow, chartsOut, derive, isUuid, sheetsOut, stationClock, stationWorkbook } from "../workbook.js";

interface LinkRow {
  id: string;
  workbook_id: string;
  token: string;
  lifetime_seconds: number;
  expires_at: Date;
  revoked_at: Date | null;
}

function linkStatus(l: LinkRow, now = new Date()): "active" | "expired" | "revoked" {
  if (l.revoked_at) return "revoked";
  return now.getTime() >= l.expires_at.getTime() ? "expired" : "active";
}

function linkOut(l: LinkRow): Record<string, unknown> {
  return { id: l.id, url: `/s/${l.token}`, expiresAt: l.expires_at.toISOString(), status: linkStatus(l) };
}

async function createLink(t: Queryable, workbookId: string, seconds: number): Promise<LinkRow> {
  const r = await t.query<LinkRow>(
    `INSERT INTO share_links (id, workbook_id, token, lifetime_seconds, expires_at)
     VALUES ($1, $2, $3, $4::integer, clock_timestamp() + make_interval(secs => $4::integer)) RETURNING *`,
    [randomUUID(), workbookId, newToken(), seconds],
  );
  return r.rows[0];
}

const NO_STORE = { "Cache-Control": "no-store" };

export function shareRoutes(svc: Services): void {
  member("GET", "/api/workbooks/:id/share-links", async ({ req, member: me }) => {
    const row = await stationWorkbook(svc.db, me.stationId, req.params.id);
    requireRole(me.role, "shareLinks");
    const r = await svc.db.query<LinkRow>("SELECT * FROM share_links WHERE workbook_id = $1 ORDER BY created_at DESC", [row.id]);
    return { status: 200, json: { links: r.rows.map(linkOut) } };
  });

  member("POST", "/api/workbooks/:id/share-links", async ({ req, member: me }) => {
    const row = await stationWorkbook(svc.db, me.stationId, req.params.id);
    requireRole(me.role, "shareLinks");
    const seconds = jsonBody(req).expiresInSeconds;
    if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 10 || seconds > 2_592_000) {
      throw invalid({ expiresInSeconds: "Pick how long the link should last." });
    }
    return { status: 201, json: { link: linkOut(await createLink(svc.db, row.id, seconds)) } };
  });

  const ownLink = async (workbookId: string, linkId: string): Promise<LinkRow> => {
    if (!isUuid(linkId)) throw notFound();
    const r = await svc.db.query<LinkRow>("SELECT * FROM share_links WHERE id = $1 AND workbook_id = $2", [linkId, workbookId]);
    if (!r.rows[0]) throw notFound();
    return r.rows[0];
  };

  member("POST", "/api/workbooks/:id/share-links/:linkId/regenerate", async ({ req, member: me }) => {
    const row = await stationWorkbook(svc.db, me.stationId, req.params.id);
    await ownLink(row.id, req.params.linkId);
    requireRole(me.role, "shareLinks");
    return tx(svc.db, async (t) => {
      const locked = await t.query<LinkRow>("SELECT * FROM share_links WHERE id = $1 FOR UPDATE", [req.params.linkId]);
      const old = locked.rows[0];
      if (linkStatus(old) !== "active") throw new ApiError(409, "link_inactive", "That link no longer works, so it can't be regenerated.");
      await t.query("UPDATE share_links SET revoked_at = clock_timestamp() WHERE id = $1", [old.id]);
      return { status: 201, json: { link: linkOut(await createLink(t, row.id, old.lifetime_seconds)) } };
    });
  });

  member("DELETE", "/api/workbooks/:id/share-links/:linkId", async ({ req, member: me }) => {
    const row = await stationWorkbook(svc.db, me.stationId, req.params.id);
    const link = await ownLink(row.id, req.params.linkId);
    requireRole(me.role, "shareLinks");
    await svc.db.query("UPDATE share_links SET revoked_at = coalesce(revoked_at, clock_timestamp()) WHERE id = $1", [link.id]);
    return { status: 204 };
  });

  open("GET", "/api/share/:token", async ({ req }) => {
    const r = await svc.db.query<LinkRow & { station_name: string; time_zone: string }>(
      `SELECT l.*, s.name AS station_name, s.time_zone FROM share_links l
       JOIN workbooks w ON w.id = l.workbook_id JOIN stations s ON s.id = w.station_id
       WHERE l.token = $1 AND l.revoked_at IS NULL AND l.expires_at > clock_timestamp()`,
      [req.params.token],
    );
    const link = r.rows[0];
    if (!link) throw notFound();
    const w = await svc.db.query<WorkbookRow>("SELECT * FROM workbooks WHERE id = $1", [link.workbook_id]);
    const row = w.rows[0];
    const engine = (await derive(svc.db, row, stationClock(link.time_zone))).engine;
    return {
      status: 200,
      headers: NO_STORE,
      json: {
        workbook: {
          name: row.name,
          stationName: link.station_name,
          state: row.state,
          expiresAt: link.expires_at.toISOString(),
          timeZone: link.time_zone,
          sheets: sheetsOut(engine, false),
          charts: chartsOut(engine).map((c) => ({ sheetName: c.sheetName, type: c.type, title: c.title, categories: c.categories, series: c.series })),
        },
      },
    };
  });

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    open(method, "/api/share/:token", async () => {
      throw new ApiError(405, "read_only", "Share links are read-only.");
    });
  }
}
