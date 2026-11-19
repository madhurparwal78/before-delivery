// Review links and the freelancer's review endpoints (brief: API > Endpoints; Business rules > Review links,
// Review comment limit).
import { newToken, reaches, requireAccount, requireSeat, tokenHash } from "../access.js";
import { config } from "../config.js";
import { iso, many, one, pool, returning, transaction } from "../db.js";
import { invalid, refuse } from "../errors.js";
import { noContent, route, send, type Context } from "../http.js";
import { sendMail } from "../mail.js";
import { reviewCluster } from "../projection.js";
import { clusterOrUnknown, type ClusterRow } from "../records.js";
import { GONE, LINK_COLUMNS, linkForToken, linkState, type LinkRow, type LinkState } from "../reviewLinks.js";
import { Fields, isCommentBody, isEmail, isName, isUuid, MESSAGES, normalEmail, text } from "../validate.js";
import { commentsOf, commentView, memberCluster } from "./clusters.js";

const EXPIRY_MAX_MS = 2_592_000_000;
const COMMENT_LIMIT = 5;
const COMMENT_WINDOW_MS = 60_000;

const reviewUrl = (token: string): string => `${config.publicUrl}/review/${token}`;
const utcMinute = (instant: Date): string => iso(instant).slice(0, 16).replace("T", " ");

function linkView(link: LinkRow, token: string) {
  return { id: link.id, email: link.email, url: reviewUrl(token), expiresAt: iso(link.expires_at), canComment: link.can_comment };
}

async function workspaceName(cluster: ClusterRow): Promise<string> {
  return (await returning<{ name: string }>(pool, "SELECT name FROM workspaces WHERE id = $1", [cluster.workspace_id])).name;
}

function reviewMail(to: string, cluster: ClusterRow, wsName: string, token: string, expiresAt: Date) {
  return sendMail({
    to,
    subject: `Review ${cluster.title} for ${wsName}`,
    lines: [
      `You have been asked to review ${cluster.title} for ${wsName} on Rushes.`,
      "",
      `Open the review: ${reviewUrl(token)}`,
      `The link expires ${utcMinute(expiresAt)} UTC.`,
    ],
  });
}

route("GET", "/api/clusters/:id/review-links", async (ctx) => {
  const { cluster } = await memberCluster(ctx);
  const links = await many<LinkRow>(pool, `SELECT ${LINK_COLUMNS} FROM review_links l WHERE l.cluster_id = $1 ORDER BY l.created_at, l.id`, [cluster.id]);
  send(ctx.res, 200, {
    links: links.map((l) => ({ id: l.id, email: l.email, expiresAt: iso(l.expires_at), canComment: l.can_comment, state: linkState(l, ctx.now) })),
  });
});

route("POST", "/api/clusters/:id/review-links", async (ctx) => {
  const { account, cluster } = await memberCluster(ctx);
  await requireSeat(pool, account, cluster.workspace_id);
  if (cluster.status !== "in_review") throw refuse("cluster_not_in_review");
  const email = normalEmail(text(ctx.json, "email"));
  const expiresText = text(ctx.json, "expiresAt") ?? "";
  const expiresAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(expiresText) ? new Date(expiresText) : null;
  const fields = new Fields().check(isEmail(email), "email", MESSAGES.email);
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= ctx.now.getTime()) fields.check(false, "expiresAt", MESSAGES.future);
  else if (expiresAt.getTime() - ctx.now.getTime() > EXPIRY_MAX_MS) fields.check(false, "expiresAt", MESSAGES.expiryWindow);
  if (fields.failed || !expiresAt) throw invalid(fields.errors);
  const token = newToken();
  const wsName = await workspaceName(cluster);
  const link = await transaction(async (client) => {
    if ((await clusterOrUnknown(client, cluster.id, true)).status !== "in_review") throw refuse("cluster_not_in_review");
    const row = await returning<LinkRow>(
      client,
      `INSERT INTO review_links AS l (cluster_id, email, token_hash, expires_at, can_comment, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${LINK_COLUMNS}`,
      [cluster.id, email, tokenHash(token), expiresAt, ctx.json.canComment === true, ctx.now],
    );
    await reviewMail(email, cluster, wsName, token, expiresAt);
    return row;
  });
  send(ctx.res, 201, linkView(link, token));
});

/** A review link in a workspace the caller reaches, by id. */
async function memberLink(ctx: Context): Promise<{ link: LinkRow; cluster: ClusterRow }> {
  const account = await requireAccount(ctx);
  const id = ctx.params.id ?? "";
  const link = isUuid(id) ? await one<LinkRow>(pool, `SELECT ${LINK_COLUMNS} FROM review_links l WHERE l.id = $1`, [id]) : null;
  const cluster = link ? await clusterOrUnknown(pool, link.cluster_id) : null;
  if (!link || !cluster || !reaches(account, { id: cluster.workspace_id, group_id: cluster.workspace_group_id })) throw refuse("not_found");
  await requireSeat(pool, account, cluster.workspace_id);
  return { link, cluster };
}

route("POST", "/api/review-links/:id/regenerate", async (ctx) => {
  const { link, cluster } = await memberLink(ctx);
  const token = newToken();
  const wsName = await workspaceName(cluster);
  await transaction(async (client) => {
    const current = await returning<LinkRow & { token_hash: string }>(client, `SELECT ${LINK_COLUMNS}, l.token_hash FROM review_links l WHERE l.id = $1 FOR UPDATE`, [link.id]);
    const state = linkState(current, ctx.now);
    if (state !== "live") throw refuse(GONE[state]);
    await client.query("INSERT INTO retired_review_tokens (token_hash, link_id) VALUES ($1, $2)", [current.token_hash, link.id]);
    await client.query("UPDATE review_links SET token_hash = $2 WHERE id = $1", [link.id, tokenHash(token)]);
    await reviewMail(link.email, cluster, wsName, token, link.expires_at);
  });
  send(ctx.res, 200, linkView(link, token));
});

route("DELETE", "/api/review-links/:id", async (ctx) => {
  const { link } = await memberLink(ctx);
  await pool.query("UPDATE review_links SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [link.id, ctx.now]);
  noContent(ctx.res);
});

/** The link and cluster behind a review token, with the link's state now; an unknown token is refused. */
async function reviewToken(ctx: Context): Promise<{ link: LinkRow; state: LinkState; cluster: ClusterRow; token: string }> {
  const token = ctx.params.token ?? "";
  const found = await linkForToken(pool, token, ctx.now);
  if (!found) throw refuse("not_found");
  return { ...found, cluster: await clusterOrUnknown(pool, found.link.cluster_id), token };
}

route("GET", "/api/review/:token", async (ctx) => {
  const { link, state, cluster, token } = await reviewToken(ctx);
  if (state !== "live") throw refuse(GONE[state]);
  send(ctx.res, 200, {
    cluster: await reviewCluster(pool, cluster, token),
    comments: (await commentsOf(cluster.id)).map(commentView),
    link: { expiresAt: iso(link.expires_at), canComment: link.can_comment },
  });
});

route("POST", "/api/review/:token/comments", async (ctx) => {
  const { link, state, cluster } = await reviewToken(ctx);
  if (!link.can_comment) throw refuse("read_only_link");
  if (state !== "live") throw refuse(GONE[state]);
  const authorName = text(ctx.json, "authorName");
  const body = text(ctx.json, "body");
  const fields = new Fields().check(isName(authorName), "authorName", MESSAGES.name).check(isCommentBody(body), "body", MESSAGES.body);
  if (fields.failed || !isName(authorName) || !isCommentBody(body)) throw invalid(fields.errors);
  // One freelancer email and cluster at a time across instances: the count and the insert are atomic.
  const comment = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`review-comments:${cluster.id}:${link.email}`]);
    const window = await many<{ created_at: Date }>(
      client,
      "SELECT created_at FROM comments WHERE cluster_id = $1 AND review_email = $2 AND created_at > $3 ORDER BY created_at",
      [cluster.id, link.email, new Date(ctx.now.getTime() - COMMENT_WINDOW_MS)],
    );
    const oldest = window[0];
    if (window.length >= COMMENT_LIMIT && oldest) {
      const wait = Math.ceil((oldest.created_at.getTime() + COMMENT_WINDOW_MS - ctx.now.getTime()) / 1000);
      const retryAfter = Math.min(60, Math.max(1, wait));
      throw refuse("rate_limited", { retryAfter }, { "Retry-After": String(retryAfter) });
    }
    return returning<{ id: string; author_name: string; body: string; created_at: Date }>(
      client,
      "INSERT INTO comments (cluster_id, author_name, body, review_email, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, author_name, body, created_at",
      [cluster.id, authorName.trim(), body, link.email, ctx.now],
    );
  });
  send(ctx.res, 201, commentView(comment));
});
