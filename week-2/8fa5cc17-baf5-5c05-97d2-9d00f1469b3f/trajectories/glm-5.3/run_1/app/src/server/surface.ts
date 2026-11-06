// The read-only share surface: /s/<token> pages and their JSON APIs, with
// the strict content security policy, the share scope rule and the cached
// sanitised renderings in the object store.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "./context.js";
import { loadShareLinkByToken, shareStatus, shareScopeIds } from "./share.js";
import { sanitizeBody } from "../shared/richtext.js";
import { expiresDisplay } from "../shared/hometime.js";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

export const SHARE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function shareHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "Content-Security-Policy": SHARE_CSP,
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, shareHeaders({ "Content-Type": "application/json" }));
  res.end(JSON.stringify(body));
}

interface ShareScopeRow {
  status: "active" | "expired" | "revoked" | "unknown";
  collectionId: string | null;
  scope: Set<string> | null;
  expiresDisplay: string | null;
}

async function loadByToken(ctx: Ctx, token: string): Promise<ShareScopeRow> {
  const link = await loadShareLinkByToken(ctx.pool, token);
  if (link === null) return { status: "unknown", collectionId: null, scope: null, expiresDisplay: null };
  const status = shareStatus(link);
  if (status !== "active") return { status, collectionId: link.collection_id, scope: null, expiresDisplay: expiresDisplay(link.expires_at, ctx.homeTimeZone) };
  const scope = await shareScopeIds(ctx.pool, link.collection_id);
  return { status, collectionId: link.collection_id, scope, expiresDisplay: expiresDisplay(link.expires_at, ctx.homeTimeZone) };
}

export async function shareSurface(ctx: Ctx, req: IncomingMessage, res: ServerResponse, method: string, path: string, query: URLSearchParams): Promise<void> {
  void query;
  // /s/<token>[...]
  const rest = path.slice("/s/".length);
  const parts = rest.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) {
    // /s alone: unknown
    if (method === "HEAD") {
      res.writeHead(404, shareHeaders());
      res.end();
      return;
    }
    sendJson(res, 404, { status: "unknown" });
    return;
  }
  const token = parts[0];

  // the API surface under /s/<token>/api/...
  if (parts[1] === "api") {
    const apiPart = parts.slice(2);
    await shareApi(ctx, res, method, token, apiPart);
    return;
  }

  // pages: /s/<token> and /s/<token>/o/<object id>
  const html = await readFile(join(publicDir, "share.html"), "utf8");
  res.writeHead(200, shareHeaders({ "Content-Type": "text/html; charset=utf-8" }));
  res.end(method === "HEAD" ? undefined : html);
}

async function shareApi(ctx: Ctx, res: ServerResponse, method: string, token: string, parts: string[]): Promise<void> {
  if (parts[0] === "status") {
    const info = await loadByToken(ctx, token);
    if (info.status === "unknown") {
      sendJson(res, 404, { status: "unknown" });
      return;
    }
    sendJson(res, 200, { status: info.status, expires_at_display: info.expiresDisplay ?? "" });
    return;
  }
  if (parts[0] === "collection") {
    const info = await loadByToken(ctx, token);
    if (info.status === "unknown") {
      sendJson(res, 404, { status: "unknown" });
      return;
    }
    if (info.status === "expired") {
      sendJson(res, 410, { status: "expired" });
      return;
    }
    if (info.status === "revoked") {
      sendJson(res, 410, { status: "revoked" });
      return;
    }
    const collection = await ctx.pool.query<{ name: string }>("SELECT name FROM collections WHERE id = $1", [info.collectionId]);
    const objects = await ctx.pool.query<{ id: string; title: string; name: string }>(
      `SELECT o.id, o.title, t.name FROM objects o
       JOIN collection_members m ON m.object_id = o.id AND m.collection_id = $1
       JOIN object_types t ON t.id = o.type_id
       WHERE o.share_visibility = 'follow'
       ORDER BY lower(o.title) ASC`,
      [info.collectionId]
    );
    sendJson(res, 200, {
      status: "active",
      collection: { name: collection.rows[0]?.name ?? "" },
      expires_at_display: info.expiresDisplay ?? "",
      objects: objects.rows.map((r) => ({ id: r.id, title: r.title, type_name: r.name })),
    });
    return;
  }
  if (parts[0] === "objects" && parts.length === 2) {
    const objectId = parts[1];
    const info = await loadByToken(ctx, token);
    if (info.status === "unknown") {
      sendJson(res, 404, { status: "unknown" });
      return;
    }
    if (info.status === "expired") {
      sendJson(res, 410, { status: "expired" });
      return;
    }
    if (info.status === "revoked") {
      sendJson(res, 410, { status: "revoked" });
      return;
    }
    const scope = info.scope ?? new Set<string>();
    if (!scope.has(objectId)) {
      sendJson(res, 404, { error: "not_in_share" });
      return;
    }
    const obj = await shareObjectJson(ctx, objectId, scope);
    if (obj === null) {
      sendJson(res, 404, { error: "not_in_share" });
      return;
    }
    // cache the sanitised rendering while the link is active
    const link = await loadShareLinkByToken(ctx.pool, token);
    if (link !== null && shareStatus(link) === "active") {
      const markup = renderShareMarkup(obj);
      ctx.s3.putObject(`share-cache/${link.id}/${objectId}.html`, Buffer.from(markup, "utf8"), "text/html").catch(() => undefined);
    }
    sendJson(res, 200, obj);
    return;
  }
  if (parts[0] === "attachments" && parts.length === 2) {
    const attachmentId = parts[1];
    const info = await loadByToken(ctx, token);
    if (info.status === "unknown") {
      sendJson(res, 404, { status: "unknown" });
      return;
    }
    if (info.status === "expired") {
      sendJson(res, 410, { status: "expired" });
      return;
    }
    if (info.status === "revoked") {
      sendJson(res, 410, { status: "revoked" });
      return;
    }
    const row = await ctx.pool.query<{ object_id: string; filename: string; content_type: string }>(
      "SELECT object_id, filename, content_type FROM attachments WHERE id = $1",
      [attachmentId]
    );
    if (row.rows.length === 0) {
      sendJson(res, 404, { error: "not_in_share" });
      return;
    }
    const scope = info.scope ?? new Set<string>();
    if (!scope.has(row.rows[0].object_id)) {
      sendJson(res, 404, { error: "not_in_share" });
      return;
    }
    const bytes = await ctx.s3.getObject(`attachments/${row.rows[0].object_id}/${attachmentId}`);
    if (bytes === null) {
      sendJson(res, 503, { error: "storage_unavailable" });
      return;
    }
    const disposition = row.rows[0].content_type.startsWith("image/") ? "inline" : "attachment";
    res.writeHead(200, shareHeaders({
      "Content-Type": row.rows[0].content_type,
      "Content-Disposition": `${disposition}; filename="${row.rows[0].filename.replace(/["\\]/g, "")}"`,
    }));
    res.end(bytes);
    return;
  }
  sendJson(res, 404, { status: "unknown" });
}

interface ShareBlock {
  id: string;
  kind: "text" | "quote" | "attachment";
  position: number;
  body: string | null;
  hidden?: boolean;
  attachment: { id: string; filename: string; content_type: string; size_bytes: number } | null;
}

interface ShareObject extends Record<string, unknown> {
  id: string;
  title: string;
  type_name: string;
  properties: Record<string, unknown>;
  blocks: ShareBlock[];
  backlinks: Array<{ from_object_id: string; from_title: string; kind: string }>;
}

/** The share object JSON, filtered by the share scope rule. */
async function shareObjectJson(ctx: Ctx, objectId: string, scope: Set<string>): Promise<ShareObject | null> {
  const row = await ctx.pool.query<{ id: string; title: string; type_name: string; type_id: string }>(
    `SELECT o.id, o.title, t.name AS type_name, o.type_id FROM objects o JOIN object_types t ON t.id = o.type_id WHERE o.id = $1`,
    [objectId]
  );
  if (row.rows.length === 0) return null;
  const fields = await ctx.pool.query<{ name: string; kind: string; target_type_id: string | null }>(
    "SELECT name, kind, target_type_id FROM type_fields WHERE type_id = $1 ORDER BY position ASC",
    [row.rows[0].type_id]
  );
  const props = await ctx.pool.query<{ field_name: string; value: unknown }>("SELECT field_name, value FROM properties WHERE object_id = $1", [objectId]);
  const properties: Record<string, unknown> = {};
  for (const p of props.rows) {
    const field = fields.rows.find((f) => f.name === p.field_name);
    // relation values pointing outside the scope are left out
    if (field !== undefined && field.kind === "relation" && typeof p.value === "string" && !scope.has(p.value)) {
      continue;
    }
    properties[p.field_name] = p.value;
  }
  const blocks = await ctx.pool.query<{
    id: string;
    kind: "text" | "quote" | "attachment";
    position: number;
    body: string;
    origin_block_id: string | null;
    attachment_id: string | null;
    filename: string | null;
    content_type: string | null;
    size_bytes: string | null;
    origin_object_id: string | null;
  }>(
    `SELECT b.id, b.kind, b.position, b.body, b.origin_block_id, b.attachment_id,
            a.filename, a.content_type, a.size_bytes::text AS size_bytes,
            ob.object_id AS origin_object_id
     FROM blocks b
     LEFT JOIN attachments a ON a.id = b.attachment_id
     LEFT JOIN blocks ob ON ob.id = b.origin_block_id
     WHERE b.object_id = $1 ORDER BY b.position ASC`,
    [objectId]
  );
  const shareBlocks: ShareBlock[] = [];
  for (const b of blocks.rows) {
    if (b.kind === "quote") {
      if (b.origin_object_id !== null && !scope.has(b.origin_object_id)) {
        shareBlocks.push({ id: b.id, kind: "quote", position: b.position, body: null, hidden: true, attachment: null });
        continue;
      }
      const origin = await ctx.pool.query<{ body: string }>("SELECT body FROM blocks WHERE id = $1", [b.origin_block_id]);
      shareBlocks.push({ id: b.id, kind: "quote", position: b.position, body: sanitizeBody(origin.rows[0]?.body ?? ""), attachment: null });
      continue;
    }
    if (b.kind === "attachment") {
      shareBlocks.push({
        id: b.id,
        kind: "attachment",
        position: b.position,
        body: null,
        attachment: {
          id: b.attachment_id ?? "",
          filename: b.filename ?? "attachment",
          content_type: b.content_type ?? "application/octet-stream",
          size_bytes: Number(b.size_bytes ?? 0),
        },
      });
      continue;
    }
    shareBlocks.push({ id: b.id, kind: "text", position: b.position, body: sanitizeBody(b.body), attachment: null });
  }
  const backlinks = await ctx.pool.query<{ from_object_id: string; from_title: string; kind: string; field_name: string | null }>(
    `SELECT e.from_object_id, o.title AS from_title, e.kind, e.field_name
     FROM link_edges e JOIN objects o ON o.id = e.from_object_id
     WHERE e.to_object_id = $1 ORDER BY e.id DESC`,
    [objectId]
  );
  return {
    id: row.rows[0].id,
    title: row.rows[0].title,
    type_name: row.rows[0].type_name,
    properties,
    blocks: shareBlocks,
    backlinks: backlinks.rows.filter((b) => scope.has(b.from_object_id)).map((b) => ({
      from_object_id: b.from_object_id,
      from_title: b.from_title,
      kind: b.kind,
    })),
  };
}

/** The sanitised markup of a shared object page, for the store cache. */
function renderShareMarkup(obj: ShareObject): string {
  const parts: string[] = [`<h1>${escapeHtml(obj.title)}</h1>`];
  for (const b of obj.blocks) {
    if (b.kind === "text" && b.body !== null) {
      parts.push(`<div class="block">${b.body}</div>`);
    } else if (b.kind === "quote") {
      if (b.hidden === true) parts.push(`<div class="block quote-hidden">Quoted from a note outside this share.</div>`);
      else parts.push(`<blockquote class="block">${b.body ?? ""}</blockquote>`);
    }
  }
  return parts.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The share cache reconciliation: within five seconds of an object leaving a
 * link's scope, its cached rendering and every cached rendering that showed
 * its body inside a quote are deleted; a revoked or regenerated link's cache
 * is removed entirely.
 */
export function startShareCacheSweep(ctx: Ctx): void {
  const sweep = async (): Promise<void> => {
    const available = await ctx.s3.available();
    if (!available) return;
    const links = await ctx.pool.query<{ id: string; token: string; collection_id: string; expires_at: Date; status: string }>(
      "SELECT id, token, collection_id, expires_at, status FROM share_links"
    );
    for (const link of links.rows) {
      const keys = await ctx.s3.listPrefix(`share-cache/${link.id}/`);
      if (keys.length === 0) continue;
      const status = shareStatus({ expires_at: new Date(link.expires_at), status: link.status });
      if (status !== "active") {
        for (const k of keys) ctx.s3.deleteObjectRetry(k).catch(() => undefined);
        continue;
      }
      const scope = await shareScopeIds(ctx.pool, link.collection_id);
      // the quote origins of each in-scope object, to catch caches that show
      // a body whose origin left the scope
      const originsByObject = new Map<string, string[]>();
      for (const key of keys) {
        const m = /\/([0-9a-f-]{36})\.html$/.exec(key);
        if (m === null) continue;
        const objectId = m[1];
        if (!scope.has(objectId)) {
          ctx.s3.deleteObjectRetry(key).catch(() => undefined);
          continue;
        }
        const origins = originsByObject.get(objectId) ?? null;
        if (origins === null) {
          const q = await ctx.pool.query<{ origin_object_id: string }>(
            `SELECT ob.object_id AS origin_object_id FROM blocks b
             JOIN blocks ob ON ob.id = b.origin_block_id
             WHERE b.object_id = $1 AND b.kind = 'quote'`,
            [objectId]
          );
          originsByObject.set(objectId, q.rows.map((r) => r.origin_object_id));
        }
        for (const origin of originsByObject.get(objectId) ?? []) {
          if (!scope.has(origin)) {
            ctx.s3.deleteObjectRetry(key).catch(() => undefined);
            break;
          }
        }
      }
    }
  };
  setInterval(() => {
    sweep().catch(() => undefined);
  }, 5000);
}
