import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ShareLink, ShareLinkStatus } from "../../shared/types.js";
import { errors } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";
import { iso } from "./session.js";
import { monthLabel } from "./roadmap.js";

const PUBLIC_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

export const shareRoutes: Route[] = [
  {
    pattern: route("roadmap/share-links"),
    methods: ["GET"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const links = await ctx.pool.query<ShareLinkRow>(
        `SELECT id, token, created_at, expires_in_seconds, expires_at, revoked_at
         FROM share_links WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC`,
        [ctx.member!.workspaceId],
      );
      return {
        status: 200,
        body: { shareLinks: links.rows.map((row) => linkToJson(ctx, row)) },
      };
    },
  },
  {
    pattern: route("roadmap/share-links"),
    methods: ["POST"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const raw = ctx.body.expiresInSeconds;
      let expiresInSeconds: number | null = null;
      if (raw !== undefined && raw !== null) {
        if (!Number.isInteger(raw) || (raw as number) < 30 || (raw as number) > 31_536_000) {
          throw errors.validationFailed({
            expiresInSeconds: "Lifetime must be a whole number of seconds from 30 to 31536000.",
          });
        }
        expiresInSeconds = raw as number;
      }
      const id = randomUUID();
      // At least 192 random bits in URL-safe characters (DP-30).
      const token = randomBytes(32).toString("base64url");
      const createdAt = new Date();
      createdAt.setMilliseconds(0);
      const expiresAt =
        expiresInSeconds === null
          ? null
          : new Date(createdAt.getTime() + expiresInSeconds * 1000);
      await ctx.pool.query(
        `INSERT INTO share_links (id, workspace_id, token, created_at, expires_in_seconds, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, workspaceId, token, createdAt, expiresInSeconds, expiresAt],
      );
      await audit(ctx.pool, workspaceId, ctx.member!.id, "create_share_link", "share_link", id, null);
      const links = await ctx.pool.query<ShareLinkRow>(
        "SELECT id, token, created_at, expires_in_seconds, expires_at, revoked_at FROM share_links WHERE id = $1",
        [id],
      );
      return { status: 201, body: { shareLink: linkToJson(ctx, links.rows[0]!) } };
    },
  },
  {
    pattern: route("roadmap/share-links/:id/regenerate"),
    methods: ["POST"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const row = await client.query<ShareLinkRow>(
          `SELECT id, token, created_at, expires_in_seconds, expires_at, revoked_at
           FROM share_links WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [id, workspaceId],
        );
        if (row.rowCount === 0) throw errors.notFound();
        if (row.rows[0]!.revoked_at !== null) throw errors.linkRevoked();
        const token = randomBytes(32).toString("base64url");
        const createdAt = new Date();
        createdAt.setMilliseconds(0);
        const expiresInSeconds = row.rows[0]!.expires_in_seconds;
        const expiresAt =
          expiresInSeconds === null
            ? null
            : new Date(createdAt.getTime() + expiresInSeconds * 1000);
        await client.query(
          `UPDATE share_links SET token = $1, created_at = $2, expires_at = $3
           WHERE id = $4`,
          [token, createdAt, expiresAt, id],
        );
        await audit(client, workspaceId, ctx.member!.id, "regenerate_share_link", "share_link", id, null);
        await client.query("COMMIT");
        const links = await client.query<ShareLinkRow>(
          "SELECT id, token, created_at, expires_in_seconds, expires_at, revoked_at FROM share_links WHERE id = $1",
          [id],
        );
        return { status: 200, body: { shareLink: linkToJson(ctx, links.rows[0]!) } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("roadmap/share-links/:id"),
    methods: ["DELETE"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const row = await client.query<{ revoked_at: Date | null }>(
          "SELECT revoked_at FROM share_links WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [id, workspaceId],
        );
        if (row.rowCount === 0) throw errors.notFound();
        if (row.rows[0]!.revoked_at === null) {
          await client.query("UPDATE share_links SET revoked_at = now() WHERE id = $1", [id]);
          await audit(client, workspaceId, ctx.member!.id, "revoke_share_link", "share_link", id, null);
        }
        await client.query("COMMIT");
        return { status: 204 };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("public/roadmap/:token"),
    methods: ["GET"],
    roles: "public",
    handler: async (ctx: RequestContext) => {
      const workspace = await activeWorkspaceForToken(ctx.pool, ctx.params.token!);
      if (workspace === null) {
        return { status: 404, body: errors.linkInactive().body(), headers: PUBLIC_HEADERS };
      }
      const columns = await publicColumns(ctx.pool, workspace.id);
      return { status: 200, body: { columns }, headers: PUBLIC_HEADERS };
    },
  },
];

interface ShareLinkRow {
  id: string;
  token: string;
  created_at: Date;
  expires_in_seconds: number | null;
  expires_at: Date | null;
  revoked_at: Date | null;
}

function linkStatus(row: ShareLinkRow): ShareLinkStatus {
  if (row.revoked_at !== null) return "revoked";
  if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) return "expired";
  return "active";
}

function linkToJson(ctx: RequestContext, row: ShareLinkRow): ShareLink {
  return {
    id: row.id,
    token: row.token,
    url: `${ctx.config.baseUrl}/r/${row.token}`,
    createdAt: iso(row.created_at),
    expiresInSeconds: row.expires_in_seconds,
    expiresAt: row.expires_at === null ? null : iso(row.expires_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
    status: linkStatus(row),
  };
}

/** A query executor satisfied by both a pool and a connected client. */
export interface QueryExecutor {
  query: PoolClient["query"];
}

/** A share link is active while it is not revoked and now < expiresAt (DP-49). */
export async function activeWorkspaceForToken(
  pool: QueryExecutor,
  token: string,
): Promise<{ id: string; name: string } | null> {
  const result = await pool.query<{
    id: string;
    name: string;
    expires_at: Date | null;
    revoked_at: Date | null;
  }>(
    `SELECT w.id, w.name, s.expires_at, s.revoked_at
     FROM share_links s JOIN workspaces w ON w.id = s.workspace_id
     WHERE s.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) return null;
  return { id: row.id, name: row.name };
}

/** The public roadmap: only public releases and published fields (DP-31). */
export interface PublicRoadmapRelease {
  name: string;
  targetMonth: string;
  features: Array<{ name: string; publicDescription: string }>;
}

export interface PublicRoadmapColumn {
  month: string;
  label: string;
  releases: PublicRoadmapRelease[];
}

export async function publicColumns(
  pool: QueryExecutor,
  workspaceId: string,
): Promise<PublicRoadmapColumn[]> {
  const releases = await pool.query<{
    id: string;
    name: string;
    target_date: string;
  }>(
    `SELECT id, name, target_date::text AS target_date FROM releases
     WHERE workspace_id = $1 AND is_public = TRUE
     ORDER BY target_date, created_at`,
    [workspaceId],
  );
  const features = await pool.query<{
    release_id: string;
    name: string;
    public_description: string;
    release_position: number;
  }>(
    `SELECT release_id, name, public_description, release_position FROM features
     WHERE workspace_id = $1 AND release_id IS NOT NULL AND status <> 'archived'
     ORDER BY release_position, created_at`,
    [workspaceId],
  );
  const byRelease = new Map<string, typeof features.rows>();
  for (const f of features.rows) {
    const list = byRelease.get(f.release_id) ?? [];
    list.push(f);
    byRelease.set(f.release_id, list);
  }
  const columnsMap = new Map<string, PublicRoadmapRelease[]>();
  for (const r of releases.rows) {
    const month = r.target_date.slice(0, 7);
    const list = columnsMap.get(month) ?? [];
    list.push({
      name: r.name,
      targetMonth: month,
      features: (byRelease.get(r.id) ?? []).map((f) => ({
        name: f.name,
        publicDescription: f.public_description,
      })),
    });
    columnsMap.set(month, list);
  }
  return [...columnsMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, rels]) => ({
      month,
      label: monthLabel(month),
      releases: rels,
    }));
}
