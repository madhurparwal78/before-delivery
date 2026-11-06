// Share links (brief: Share links). Transitions decided here: active → expired by time; active →
// revoked by request, by a plain delete of its key, by removing its creator, or by removal of its version.
import type pg from "pg";
import { authorize, membership } from "./access.js";
import { one, pool, query, tx, type Db } from "./db.js";
import { ApiError, invalid, jsonError, rateLimited, transition } from "./errors.js";
import { downloadHeaders, openVersion, servedType, streamBody } from "./downloads.js";
import { fieldErrors, header, isoSecond, readJson, secondsUntil, send, sendJson, truncateToSecond, type Ctx } from "./http.js";
import { LINK_EXPIRY_MESSAGE, LINK_RATE, linkExpiryAllowed, RATE_WINDOW_SECONDS } from "./limits.js";
import { currentVersion, versionById, workspaceBucket, type Bucket, type Version } from "./objects.js";
import { newId, randomToken, sha256Hex } from "./secrets.js";
import { meterRead } from "./usage.js";

interface LinkRow {
  id: string;
  workspace_id: string;
  bucket_id: number;
  key: string;
  version_id: string;
  created_by: string;
  created_at: Date;
  expires_at: Date;
  state: "active" | "revoked";
}

type LinkState = "active" | "expired" | "revoked";

function linkState(link: Pick<LinkRow, "state" | "expires_at">, now: Date): LinkState {
  if (link.state === "revoked") return "revoked";
  return now.getTime() >= link.expires_at.getTime() ? "expired" : "active";
}

type LinkScope = { linkId: string } | { bucketId: number; key: string } | { versionId: string } | { workspaceId: string; createdBy: string };

// active → revoked, for every cause: a request, a plain delete of its key, removal of its creator or
// removal of its version. Only links linkState judges active move; answers how many did.
export async function revokeLinks(client: pg.PoolClient, scope: LinkScope, now: Date): Promise<number> {
  const [where, params]: [string, unknown[]] = "linkId" in scope ? ["id = $1", [scope.linkId]]
    : "versionId" in scope ? ["version_id = $1", [scope.versionId]]
    : "createdBy" in scope ? ["workspace_id = $1 AND created_by = $2", [scope.workspaceId, scope.createdBy]]
    : ["bucket_id = $1 AND key = $2", [scope.bucketId, scope.key]];
  const candidates = await query<LinkRow>(client, `SELECT * FROM share_links WHERE state = 'active' AND ${where} FOR UPDATE`, params);
  const active = candidates.filter((link) => linkState(link, now) === "active").map((link) => link.id);
  if (active.length) await client.query("UPDATE share_links SET state = 'revoked' WHERE id = ANY($1)", [active]);
  return active.length;
}

// Resolves the `key` and optional `version` query parameters to a stored version, or 404.
export async function versionFromQuery(db: Db, ctx: Ctx, bucket: Bucket): Promise<Version> {
  const key = ctx.query.get("key") ?? "";
  const versionId = ctx.query.get("version");
  const version = versionId ? await versionById(db, bucket.id, key, versionId) : await currentVersion(db, bucket.id, key);
  if (!version) throw new ApiError("not_found");
  return version;
}

export async function mintLink(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  const bucket = await workspaceBucket(pool, m.workspace.id, ctx.params.bucket ?? "");
  const version = await versionFromQuery(pool, ctx, bucket);
  authorize(m, "mint_link", true);
  const body = await readJson(ctx);
  const errors = fieldErrors(body, ["expires_in_seconds"], ["expires_in_seconds"]);
  if (!errors.expires_in_seconds && !linkExpiryAllowed(body.expires_in_seconds)) errors.expires_in_seconds = LINK_EXPIRY_MESSAGE;
  if (Object.keys(errors).length) throw invalid(errors);
  const token = randomToken(32);
  const createdAt = truncateToSecond(ctx.now);
  const expiresAt = new Date(createdAt.getTime() + (body.expires_in_seconds as number) * 1000);
  const id = newId();
  await pool.query(
    `INSERT INTO share_links (id, workspace_id, bucket_id, key, version_id, token_hash, created_by, created_at, expires_at, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')`,
    [id, m.workspace.id, bucket.id, version.key, version.version_id, sha256Hex(token), m.user.id, createdAt, expiresAt]);
  sendJson(ctx, 201, {
    id, url: `${ctx.origin}/l/${token}`, bucket: bucket.name, key: version.key, version_id: version.version_id,
    expires_at: isoSecond(expiresAt), state: "active",
  });
}

export async function listLinks(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "read");
  const rows = await query<LinkRow & { bucket: string; creator: string }>(pool,
    `SELECT l.*, b.name AS bucket, u.name AS creator FROM share_links l
     JOIN buckets b ON b.id = l.bucket_id JOIN users u ON u.id = l.created_by
     WHERE l.workspace_id = $1 ORDER BY l.created_at DESC, l.id`, [m.workspace.id]);
  sendJson(ctx, 200, {
    links: rows.map((l) => ({
      id: l.id, bucket: l.bucket, key: l.key, version_id: l.version_id, created_by: l.creator, created_at: isoSecond(l.created_at), expires_at: isoSecond(l.expires_at),
      state: linkState(l, ctx.now),
    })),
  });
}

export async function revokeLink(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  const updated = await tx(async (client) => {
    const link = await one<LinkRow & { bucket: string; creator: string }>(client,
      `SELECT l.*, b.name AS bucket, u.name AS creator FROM share_links l JOIN buckets b ON b.id = l.bucket_id
       JOIN users u ON u.id = l.created_by WHERE l.id = $1 AND l.workspace_id = $2 FOR UPDATE OF l`,
      [ctx.params.id ?? "", m.workspace.id]);
    if (!link) throw new ApiError("not_found");
    authorize(m, link.created_by === m.user.id ? "mint_link" : "revoke_any_link");
    const state = linkState(link, ctx.now);
    if (state !== "active") throw transition(state, "revoked");
    await revokeLinks(client, { linkId: link.id }, ctx.now);
    return { ...link, state: "revoked" as const };
  });
  sendJson(ctx, 200, {
    id: updated.id, bucket: updated.bucket, key: updated.key, version_id: updated.version_id, created_by: updated.creator,
    created_at: isoSecond(updated.created_at), expires_at: isoSecond(updated.expires_at), state: "revoked",
  });
}

// ---- The link recipient ----

const RECIPIENT_PAGE: Record<string, string> = {
  not_found: "This link doesn't exist.",
  link_expired: "This link has expired.",
  link_revoked: "This link was revoked.",
  workspace_suspended: "This link is paused.",
};

function recipientHtml(heading: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Farshore</title><style>html{background:#0E1116;color:#EDE4D3;font:16px/1.5 system-ui,sans-serif}` +
    `body{margin:0;min-height:100vh;display:grid;place-items:center}main{padding:32px;max-width:36rem;text-align:center}` +
    `h1{font-size:23px;font-weight:500;margin:0}</style></head><body><main><h1>${heading}</h1></main></body></html>`;
}

function refuseRecipient(ctx: Ctx, error: ApiError): void {
  const heading = error.code === "rate_limited"
    ? `Too many downloads right now. Try again in ${error.retryAfter ?? 1} seconds.`
    : RECIPIENT_PAGE[error.code] ?? "This link doesn't exist.";
  const headers: Record<string, string> = {};
  if (error.retryAfter !== undefined) headers["Retry-After"] = String(error.retryAfter);
  if ((header(ctx, "accept") ?? "").includes("text/html")) {
    send(ctx, error.status, { "Content-Type": "text/html; charset=utf-8", ...headers }, recipientHtml(heading));
  } else {
    send(ctx, error.status, { "Content-Type": "application/json; charset=utf-8", ...headers },
      jsonError(new ApiError(error.code, heading, error.extra, error.retryAfter)));
  }
}

// GET and HEAD /l/{token}: exactly one object version, the file and its download headers only.
export async function serveLink(ctx: Ctx, token: string): Promise<void> {
  try {
    const served = await tx(async (client) => {
      const link = await one<LinkRow & { status: string }>(client,
        `SELECT l.*, w.status FROM share_links l JOIN workspaces w ON w.id = l.workspace_id
         WHERE l.token_hash = $1 FOR UPDATE OF l`, [sha256Hex(token)]);
      if (!link) throw new ApiError("not_found");
      const windowStart = new Date(ctx.now.getTime() - RATE_WINDOW_SECONDS * 1000);
      const hits = await query<{ at: Date }>(client,
        "SELECT at FROM share_link_hits WHERE link_id = $1 AND at > $2 ORDER BY at", [link.id, windowStart]);
      const oldest = hits[0];
      if (hits.length >= LINK_RATE && oldest) {
        throw rateLimited(secondsUntil(ctx.now, new Date(oldest.at.getTime() + RATE_WINDOW_SECONDS * 1000)));
      }
      await client.query("INSERT INTO share_link_hits (link_id, at) VALUES ($1, $2)", [link.id, ctx.now]);
      if (link.status === "suspended") throw new ApiError("workspace_suspended");
      const state = linkState(link, ctx.now);
      if (state === "expired") throw new ApiError("link_expired");
      if (state === "revoked") throw new ApiError("link_revoked");
      const version = await one<Version>(client, "SELECT * FROM versions WHERE version_id = $1", [link.version_id]);
      const bucket = await one<Bucket>(client, "SELECT * FROM buckets WHERE id = $1", [link.bucket_id]);
      if (!version || !bucket) throw new ApiError("link_revoked");
      return { version, bucket };
    });
    const { version, bucket } = served;
    const body = ctx.method === "HEAD" ? null : await openVersion(bucket, version);
    if (ctx.method === "GET") await meterRead(bucket, version.size);
    await streamBody(ctx, 200, {
      "Content-Type": servedType(version, false),
      "Content-Length": version.size,
      ETag: version.etag,
      "Last-Modified": version.last_modified.toUTCString(),
      ...downloadHeaders(version.key),
    }, body);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 503) refuseRecipient(ctx, error);
    else throw error;
  }
}

