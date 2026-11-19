// Search, clusters, entries, order, status, comments and the cluster sheet (brief: API > Endpoints;
// Business rules > Tenancy, Order, Cluster lifecycle, Embargo time).
import type { PoolClient } from "pg";
import { memberWorkspace, reaches, requireAccount, requireSeat, workspaceById, type Account } from "../access.js";
import { csvLines, quoted, textCell } from "../csv.js";
import { iso, many, one, pool, returning, transaction } from "../db.js";
import { resolveLiftLocal } from "../embargo.js";
import { invalid, refuse } from "../errors.js";
import { route, send, type Context, type Json } from "../http.js";
import { canRequest, isLocked, mayWithdraw } from "../../shared/lifecycle.js";
import {
  bumpVersion,
  clusterOrUnknown,
  clusterRows,
  clusterSummary,
  clusterView,
  entriesOf,
  entryView,
  REFERENCE_SELECT,
  referenceView,
  type ClusterRow,
  type ReferenceRow,
} from "../records.js";
import { appendEntry } from "./references.js";
import { Fields, isCommentBody, isLongText, isQuery, isTitle, isUuid, liftGapMessage, MESSAGES, positionMessage, text } from "../validate.js";

const LIST_MAX = 20;

/** A cluster the caller reaches; anything else is unknown. */
export async function memberCluster(ctx: Context): Promise<{ account: Account; cluster: ClusterRow }> {
  const account = await requireAccount(ctx);
  const cluster = await clusterOrUnknown(pool, ctx.params.id ?? "");
  if (!reaches(account, { id: cluster.workspace_id, group_id: cluster.workspace_group_id })) throw refuse("not_found");
  return { account, cluster };
}

const titleMatch = (column: string, param: string): string => `strpos(lower(${column}), lower(${param})) > 0`;

route("GET", "/api/workspaces/:ws/search", async (ctx) => {
  const account = await requireAccount(ctx);
  const ws = await memberWorkspace(account, ctx.params.ws ?? "");
  const q = ctx.query.get("q");
  if (!isQuery(q)) throw invalid({ q: MESSAGES.q });
  const refsWhere = `r.workspace_id = $1 AND (${titleMatch("r.title", "$2")} OR (r.kind = 'still' AND ${titleMatch("coalesce(r.source_clip_title, '')", "$2")}))`;
  const [clusters, clusterTotal, references, referenceTotal] = await Promise.all([
    clusterRows(pool, `c.workspace_id = $1 AND ${titleMatch("c.title", "$2")}`, [ws.id, q], `ORDER BY c.changed_at DESC, c.id DESC LIMIT ${LIST_MAX}`),
    returning<{ n: number }>(pool, `SELECT count(*)::int AS n FROM clusters c WHERE c.workspace_id = $1 AND ${titleMatch("c.title", "$2")}`, [ws.id, q]),
    many<ReferenceRow>(pool, `${REFERENCE_SELECT} WHERE ${refsWhere} ORDER BY r.created_at DESC, r.id DESC LIMIT ${LIST_MAX}`, [ws.id, q]),
    returning<{ n: number }>(pool, `SELECT count(*)::int AS n FROM "references" r WHERE ${refsWhere}`, [ws.id, q]),
  ]);
  send(ctx.res, 200, {
    query: q,
    counts: { clusters: clusterTotal.n, references: referenceTotal.n },
    clusters: clusters.map(clusterSummary),
    references: references.map(referenceView),
  });
});

route("GET", "/api/workspaces/:ws/clusters", async (ctx) => {
  const account = await requireAccount(ctx);
  const ws = await memberWorkspace(account, ctx.params.ws ?? "");
  const q = ctx.query.get("q") || null;
  if (q !== null && !isQuery(q)) throw invalid({ q: MESSAGES.q });
  const where = q === null ? "c.workspace_id = $1" : `c.workspace_id = $1 AND ${titleMatch("c.title", "$2")}`;
  const params = q === null ? [ws.id] : [ws.id, q];
  const [rows, total] = await Promise.all([
    clusterRows(pool, where, params, `ORDER BY c.changed_at DESC, c.id DESC LIMIT ${LIST_MAX}`),
    returning<{ n: number }>(pool, `SELECT count(*)::int AS n FROM clusters c WHERE ${where}`, params),
  ]);
  send(ctx.res, 200, { total: total.n, clusters: rows.map(clusterSummary) });
});

function detailFields(body: Record<string, Json>, creating: boolean): Fields {
  const fields = new Fields();
  if (creating || "title" in body) fields.check(isTitle(text(body, "title")), "title", MESSAGES.title);
  for (const field of ["publicDescription", "internalNote"]) {
    if (field in body) fields.check(isLongText(text(body, field)), field, MESSAGES.longText);
  }
  return fields;
}

route("POST", "/api/workspaces/:ws/clusters", async (ctx) => {
  const account = await requireAccount(ctx);
  const ws = await memberWorkspace(account, ctx.params.ws ?? "");
  await requireSeat(pool, account, ws.id);
  const fields = detailFields(ctx.json, true);
  if (fields.failed) throw invalid(fields.errors);
  const created = await returning<{ id: string }>(
    pool,
    `INSERT INTO clusters (workspace_id, title, public_description, internal_note, status, owner_id, created_at, changed_at)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $6) RETURNING id`,
    [ws.id, text(ctx.json, "title"), text(ctx.json, "publicDescription") ?? "", text(ctx.json, "internalNote") ?? "", account.id, ctx.now],
  );
  send(ctx.res, 201, await clusterView(pool, await clusterOrUnknown(pool, created.id)));
});

route("GET", "/api/clusters/:id", async (ctx) => {
  const { cluster } = await memberCluster(ctx);
  send(ctx.res, 200, await clusterView(pool, cluster));
});

route("PATCH", "/api/clusters/:id", async (ctx) => {
  const { account, cluster } = await memberCluster(ctx);
  await requireSeat(pool, account, cluster.workspace_id);
  const updated = await transaction(async (client) => {
    const current = await clusterOrUnknown(client, cluster.id, true);
    if ("publicDescription" in ctx.json && isLocked(current.status)) throw refuse("cluster_locked");
    const fields = detailFields(ctx.json, false);
    if (fields.failed) throw invalid(fields.errors);
    await client.query(
      `UPDATE clusters SET title = coalesce($2, title), public_description = coalesce($3, public_description),
         internal_note = coalesce($4, internal_note), changed_at = $5 WHERE id = $1`,
      [cluster.id, text(ctx.json, "title"), text(ctx.json, "publicDescription"), text(ctx.json, "internalNote"), ctx.now],
    );
    return clusterOrUnknown(client, cluster.id);
  });
  send(ctx.res, 200, await clusterView(pool, updated));
});

route("POST", "/api/clusters/:id/entries", async (ctx) => {
  const { account, cluster } = await memberCluster(ctx);
  const referenceId = text(ctx.json, "referenceId");
  const reference = isUuid(referenceId) ? await one(pool, `SELECT 1 FROM "references" WHERE id = $1 AND workspace_id = $2`, [referenceId, cluster.workspace_id]) : null;
  if (!reference || !referenceId) throw refuse("not_found");
  await requireSeat(pool, account, cluster.workspace_id);
  const placed = await transaction(async (client) => {
    const current = await clusterOrUnknown(client, cluster.id, true);
    if (isLocked(current.status)) throw refuse("cluster_locked");
    if (await one(client, "SELECT 1 FROM entries WHERE cluster_id = $1 AND reference_id = $2", [cluster.id, referenceId])) throw refuse("already_in_cluster");
    return appendEntry(client, cluster.id, referenceId, ctx.json.isPrivate === true, account.id, ctx.now);
  });
  send(ctx.res, 201, {
    entry: entryView({ entry_id: placed.entry_id, position: placed.position, is_private: ctx.json.isPrivate === true }),
    itemCount: placed.item_count,
    version: placed.version,
  });
});

/** An entry of a cluster the caller reaches, checked before the seat (precedence 3 before 4). */
async function memberEntry(ctx: Context): Promise<{ account: Account; cluster: ClusterRow }> {
  const found = await memberCluster(ctx);
  const entryId = ctx.params.entryId ?? "";
  if (!isUuid(entryId) || !(await one(pool, "SELECT 1 FROM entries WHERE id = $1 AND cluster_id = $2", [entryId, found.cluster.id]))) throw refuse("not_found");
  return found;
}

/** Shared shape of the entry endpoints: lock the cluster and find the entry. */
async function lockedEntry(ctx: Context, client: PoolClient): Promise<{ cluster: ClusterRow; entry: { id: string; position: number; is_private: boolean } }> {
  const cluster = await clusterOrUnknown(client, ctx.params.id ?? "", true);
  const entryId = ctx.params.entryId ?? "";
  const entry = isUuid(entryId) ? await one<{ id: string; position: number; is_private: boolean }>(client, "SELECT id, position, is_private FROM entries WHERE id = $1 AND cluster_id = $2", [entryId, cluster.id]) : null;
  if (!entry) throw refuse("not_found");
  return { cluster, entry };
}

route("PATCH", "/api/clusters/:id/entries/:entryId", async (ctx) => {
  const { account, cluster } = await memberEntry(ctx);
  await requireSeat(pool, account, cluster.workspace_id);
  const result = await transaction(async (client) => {
    const { cluster: current, entry } = await lockedEntry(ctx, client);
    if (isLocked(current.status)) throw refuse("cluster_locked");
    const isPrivate = ctx.json.isPrivate === true;
    await client.query("UPDATE entries SET is_private = $2 WHERE id = $1", [entry.id, isPrivate]);
    return { entry: entryView({ entry_id: entry.id, position: entry.position, is_private: isPrivate }), ...(await bumpVersion(client, cluster.id, ctx.now)) };
  });
  send(ctx.res, 200, { entry: result.entry, itemCount: result.item_count, version: result.version });
});

route("DELETE", "/api/clusters/:id/entries/:entryId", async (ctx) => {
  const { account, cluster } = await memberEntry(ctx);
  await requireSeat(pool, account, cluster.workspace_id);
  const result = await transaction(async (client) => {
    const { cluster: current, entry } = await lockedEntry(ctx, client);
    if (isLocked(current.status)) throw refuse("cluster_locked");
    await client.query("DELETE FROM entries WHERE id = $1", [entry.id]);
    await client.query("UPDATE entries SET position = position - 1 WHERE cluster_id = $1 AND position > $2", [cluster.id, entry.position]);
    return bumpVersion(client, cluster.id, ctx.now);
  });
  send(ctx.res, 200, { itemCount: result.item_count, version: result.version });
});

const orderOf = async (client: PoolClient, clusterId: string): Promise<string[]> =>
  (await many<{ id: string }>(client, "SELECT id FROM entries WHERE cluster_id = $1 ORDER BY position", [clusterId])).map((e) => e.id);

route("POST", "/api/clusters/:id/entries/:entryId/move", async (ctx) => {
  const { account, cluster } = await memberEntry(ctx);
  await requireSeat(pool, account, cluster.workspace_id);
  const result = await transaction(async (client) => {
    const { cluster: current, entry } = await lockedEntry(ctx, client);
    if (isLocked(current.status)) throw refuse("cluster_locked");
    if (ctx.json.version !== current.version) {
      throw refuse("stale_order", { version: current.version, entryIds: await orderOf(client, cluster.id) });
    }
    const to = ctx.json.toPosition;
    if (typeof to !== "number" || !Number.isInteger(to) || to < 1 || to > current.item_count) {
      throw invalid({ toPosition: positionMessage(current.item_count) });
    }
    if (to < entry.position) {
      await client.query("UPDATE entries SET position = position + 1 WHERE cluster_id = $1 AND position >= $2 AND position < $3", [cluster.id, to, entry.position]);
    } else if (to > entry.position) {
      await client.query("UPDATE entries SET position = position - 1 WHERE cluster_id = $1 AND position > $2 AND position <= $3", [cluster.id, entry.position, to]);
    }
    await client.query("UPDATE entries SET position = $2 WHERE id = $1", [entry.id, to]);
    const { version } = await bumpVersion(client, cluster.id, ctx.now);
    return { version, entryIds: await orderOf(client, cluster.id) };
  });
  send(ctx.res, 200, result);
});

route("POST", "/api/clusters/:id/status", async (ctx) => {
  const { account, cluster } = await memberCluster(ctx);
  const to = text(ctx.json, "status") ?? "";
  if (to === "withdrawn" && !mayWithdraw(account.role, account.id === cluster.owner_id)) throw refuse("forbidden");
  await requireSeat(pool, account, cluster.workspace_id);
  const ws = await workspaceById(pool, cluster.workspace_id);
  // The cluster row lock makes status changes one at a time across instances; each request is judged against
  // the status the previous winner left.
  const updated = await transaction(async (client) => {
    const current = await clusterOrUnknown(client, cluster.id, true);
    if (!canRequest(current.status, to)) throw refuse("illegal_transition", { from: current.status, to });
    if (to === "embargoed") {
      const liftLocal = text(ctx.json, "liftLocal") ?? "";
      const resolved = resolveLiftLocal(liftLocal, ws.time_zone);
      if (!resolved.ok) throw invalid({ liftLocal: resolved.reason === "gap" ? liftGapMessage(ws.time_zone) : MESSAGES.liftFormat });
      if (resolved.liftsAt.getTime() <= ctx.now.getTime()) throw invalid({ liftLocal: MESSAGES.future });
      await client.query("UPDATE clusters SET status = 'embargoed', lift_local = $2, lifts_at = $3, changed_at = $4 WHERE id = $1", [cluster.id, liftLocal, resolved.liftsAt, ctx.now]);
    } else if (to === "in_review") {
      await client.query("UPDATE clusters SET status = 'in_review', lift_local = NULL, lifts_at = NULL, changed_at = $2 WHERE id = $1", [cluster.id, ctx.now]);
    } else {
      await client.query("UPDATE clusters SET status = $2, changed_at = $3 WHERE id = $1", [cluster.id, to, ctx.now]);
    }
    if (current.status === "in_review") {
      await client.query("UPDATE review_links SET inactive_at = $2 WHERE cluster_id = $1 AND inactive_at IS NULL", [cluster.id, ctx.now]);
    }
    return clusterOrUnknown(client, cluster.id);
  });
  send(ctx.res, 200, await clusterView(pool, updated));
});

interface CommentRow {
  id: string;
  author_name: string;
  body: string;
  created_at: Date;
}

export const commentView = (k: CommentRow) => ({ id: k.id, authorName: k.author_name, body: k.body, createdAt: iso(k.created_at) });

export const commentsOf = (clusterId: string): Promise<CommentRow[]> =>
  many<CommentRow>(pool, "SELECT id, author_name, body, created_at FROM comments WHERE cluster_id = $1 ORDER BY created_at, id", [clusterId]);

route("GET", "/api/clusters/:id/comments", async (ctx) => {
  const { cluster } = await memberCluster(ctx);
  send(ctx.res, 200, { comments: (await commentsOf(cluster.id)).map(commentView) });
});

route("POST", "/api/clusters/:id/comments", async (ctx) => {
  const { account, cluster } = await memberCluster(ctx);
  await requireSeat(pool, account, cluster.workspace_id);
  const body = text(ctx.json, "body");
  if (!isCommentBody(body)) throw invalid({ body: MESSAGES.body });
  const row = await returning<CommentRow>(
    pool,
    "INSERT INTO comments (cluster_id, author_name, body, account_id, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, author_name, body, created_at",
    [cluster.id, account.display_name, body, account.id, ctx.now],
  );
  send(ctx.res, 201, commentView(row));
});

route("GET", "/api/clusters/:id/export.csv", async (ctx) => {
  const { cluster } = await memberCluster(ctx);
  const rows = (await entriesOf(pool, cluster.id)).map((e) => [
    String(e.position),
    textCell(e.title),
    e.kind,
    e.kind === "still" ? textCell(e.source_clip_title ?? "") : "",
    e.kind === "still" ? quoted(e.timecode ?? "") : "",
    e.is_private ? "yes" : "no",
  ]);
  const sheet = csvLines([["position", "title", "kind", "source_clip", "timecode", "private"], ...rows]);
  ctx.res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="cluster-${cluster.id}.csv"`,
    "Content-Length": Buffer.byteLength(sheet),
    "Cache-Control": "no-store",
  });
  ctx.res.end(sheet);
});
