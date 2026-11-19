// The public side: discovery feed, public cluster, curator profiles and follows (brief: API > Endpoints;
// Business rules > Feed, Curators, Follows).
import { requireAccount } from "../access.js";
import { decodeCursor, encodeCursor, parseLimit } from "../cursor.js";
import { one, pool, returning } from "../db.js";
import { invalid, refuse } from "../errors.js";
import { route, send, type Context } from "../http.js";
import { covers, curatorCluster, feedCard, publicCluster } from "../projection.js";
import { clusterRows, findCluster } from "../records.js";
import { isHandle, isUuid, MESSAGES, Fields } from "../validate.js";

const FEED_DEFAULT = 20;
const FEED_MAX = 50;
const FEED_SCOPE = "public";

route("GET", "/api/feed", async (ctx) => {
  const fields = new Fields();
  const limit = parseLimit(ctx.query.get("limit"), FEED_DEFAULT, FEED_MAX);
  fields.check(limit !== null, "limit", MESSAGES.limit);
  const rawCursor = ctx.query.get("cursor");
  const after = rawCursor === null ? null : decodeCursor(rawCursor, "feed", FEED_SCOPE);
  fields.check(rawCursor === null || after !== null, "cursor", MESSAGES.cursor);
  if (fields.failed || limit === null) throw invalid(fields.errors);
  const rows = await clusterRows(
    pool,
    after ? "c.status = 'public' AND (c.published_at, c.id::text) < ($2, $3)" : "c.status = 'public'",
    after ? [limit + 1, after.sortValue, after.id] : [limit + 1],
    "ORDER BY c.published_at DESC, c.id::text DESC LIMIT $1",
  );
  const items = rows.slice(0, limit);
  const cover = await covers(pool, items.map((c) => c.id));
  const last = items[items.length - 1];
  send(ctx.res, 200, {
    items: items.map((c) => feedCard(c, cover.get(c.id))),
    nextCursor: rows.length > limit && last?.published_at ? encodeCursor("feed", FEED_SCOPE, last.published_at, last.id) : null,
  });
});

route("GET", "/api/public/clusters/:id", async (ctx) => {
  const id = ctx.params.id ?? "";
  const cluster = isUuid(id) ? await findCluster(pool, id) : null;
  if (!cluster || cluster.status !== "public") throw refuse("not_found");
  send(ctx.res, 200, await publicCluster(pool, cluster));
});

interface CuratorRow {
  id: string;
  display_name: string;
  handle: string;
}

async function curator(ctx: Context): Promise<CuratorRow> {
  const handle = ctx.params.handle ?? "";
  const row = isHandle(handle) ? await one<CuratorRow>(pool, "SELECT id, display_name, handle FROM accounts WHERE handle = $1", [handle]) : null;
  if (!row) throw refuse("not_found");
  return row;
}

const followerCount = async (curatorId: string): Promise<number> =>
  (await returning<{ n: number }>(pool, "SELECT count(*)::int AS n FROM follows WHERE curator_id = $1", [curatorId])).n;

route("GET", "/api/curators/:handle", async (ctx) => {
  const person = await curator(ctx);
  const clusters = await clusterRows(pool, "c.owner_id = $1 AND c.status = 'public'", [person.id], "ORDER BY c.published_at DESC, c.id DESC");
  const cover = await covers(pool, clusters.map((c) => c.id));
  send(ctx.res, 200, {
    displayName: person.display_name,
    handle: person.handle,
    followerCount: await followerCount(person.id),
    clusters: clusters.map((c) => curatorCluster(c, cover.get(c.id))),
  });
});

route("POST", "/api/curators/:handle/follow", async (ctx) => {
  const account = await requireAccount(ctx);
  const person = await curator(ctx);
  if (person.id === account.id) throw invalid({ handle: MESSAGES.handleSelf });
  await pool.query("INSERT INTO follows (follower_id, curator_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [account.id, person.id]);
  send(ctx.res, 200, { following: true, followerCount: await followerCount(person.id) });
});

route("DELETE", "/api/curators/:handle/follow", async (ctx) => {
  const account = await requireAccount(ctx);
  const person = await curator(ctx);
  await pool.query("DELETE FROM follows WHERE follower_id = $1 AND curator_id = $2", [account.id, person.id]);
  send(ctx.res, 200, { following: false, followerCount: await followerCount(person.id) });
});
