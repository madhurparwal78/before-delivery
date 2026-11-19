// Cluster endpoints: reads, details, entries, moves, status, comments, the sheet
// export and review links.

import http from 'node:http';
import type { URL } from 'node:url';
import type { App, Ctx, Handler } from '../app.js';
import { isUuid } from '../ids.js';
import { sendJson, readJsonBody } from '../http-helpers.js';
import { one, many } from '../db.js';
import { E } from '../e.js';
import { notFound } from '../errors.js';
import { requireMember, requireSeat } from '../context.js';
import type { MemberContext } from '../context.js';
import { referenceView, type ClusterRow, type ReferenceRow } from '../projections.js';
import { codePoints, positionField, commentBody, titleField, textField, type FieldErrors } from '../validate.js';
import { clusterFull } from './workspaces.js';
import { effectiveStatusOf, resolveLift, liftLocalOf, nowDate } from '../time.js';
import { isLegalEdge, lockedStatus } from '../lifecycle.js';
import { csvCell } from '../../shared/domain.js';
import { newToken, newId } from '../passwords.js';
import { STATUS_LABELS } from '../../shared/constants.js';

export function clusterRoutes(method: string, pathname: string): Handler | null {
  const mk = (fn: (id: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL) => Promise<void>, id: string): Handler => {
    if (!isUuid(id)) return notFoundHandler;
    return (app, req, res, ctx, url) => fn(id, app, req, res, ctx, url);
  };
  const mk2 = (fn: (id: string, id2: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL) => Promise<void>, id: string, id2: string): Handler => {
    if (!isUuid(id) || !isUuid(id2)) return notFoundHandler;
    return (app, req, res, ctx, url) => fn(id, id2, app, req, res, ctx, url);
  };
  let m: RegExpExecArray | null;
  if ((m = /^\/api\/clusters\/([^/]+)$/.exec(pathname))) {
    const id = m[1]!;
    if (method === 'GET') return mk(clusterGet, id);
    if (method === 'PATCH') return mk(clusterPatch, id);
  }
  if ((m = /^\/api\/clusters\/([^/]+)\/comments$/.exec(pathname))) {
    const id = m[1]!;
    if (method === 'GET') return mk(commentsGet, id);
    if (method === 'POST') return mk(commentPost, id);
  }
  if ((m = /^\/api\/clusters\/([^/]+)\/entries$/.exec(pathname))) {
    const id = m[1]!;
    if (method === 'POST') return mk(entryAdd, id);
  }
  if ((m = /^\/api\/clusters\/([^/]+)\/entries\/([^/]+)$/.exec(pathname))) {
    const id = m[1]!;
    const id2 = m[2]!;
    if (method === 'PATCH') return mk2(entryPatch, id, id2);
    if (method === 'DELETE') return mk2(entryDelete, id, id2);
  }
  if ((m = /^\/api\/clusters\/([^/]+)\/entries\/([^/]+)\/move$/.exec(pathname))) {
    const id = m[1]!;
    const id2 = m[2]!;
    if (method === 'POST') return mk2(entryMove, id, id2);
  }
  if ((m = /^\/api\/clusters\/([^/]+)\/status$/.exec(pathname))) {
    const id = m[1]!;
    if (method === 'POST') return mk(statusChange, id);
  }
  if ((m = /^\/api\/clusters\/([^/]+)\/export\.csv$/.exec(pathname))) {
    const id = m[1]!;
    if (method === 'GET') return mk(exportCsv, id);
  }
  if ((m = /^\/api\/clusters\/([^/]+)\/review-links$/.exec(pathname))) {
    const id = m[1]!;
    if (method === 'GET') return mk(reviewLinksGet, id);
    if (method === 'POST') return mk(reviewLinkCreate, id);
  }
  if ((m = /^\/api\/review-links\/([^/]+)\/regenerate$/.exec(pathname))) {
    const id = m[1]!;
    if (method === 'POST') return mk(reviewLinkRegenerate, id);
  }
  if ((m = /^\/api\/review-links\/([^/]+)$/.exec(pathname))) {
    const id = m[1]!;
    if (method === 'DELETE') return mk(reviewLinkRevoke, id);
  }
  return null;
}

const notFoundHandler: Handler = async (_app, _req, res) => {
  throw notFound();
};

/** Load a cluster that is inside the viewer's reach, with its workspace. */
async function loadCluster(ctx: Ctx, clusterId: string, slug: string): Promise<{ row: ClusterRow; member: MemberContext }> {
  const member = await requireMember(ctx, slug);
  const row = await one<ClusterRow>(ctx.db, `select * from clusters where id = $1 and workspace_id = $2`, [clusterId, member.workspace.id]);
  if (!row) throw E.notFound();
  return { row, member };
}

async function clusterGet(clusterId: string, app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const row = await one<ClusterRow & { slug: string; time_zone: string }>(
    ctx.db,
    `select c.*, w.slug, w.time_zone from clusters c join workspaces w on w.id = c.workspace_id where c.id = $1`,
    [clusterId],
  );
  if (!row) throw E.notFound();
  const member = await requireMember(ctx, row.slug);
  const eff = effectiveStatusOf(row.status, row.lifts_at, nowDate());
  const view = await clusterFull(ctx, { ...row, status: eff }, row.slug, row.time_zone);
  void member;
  sendJson(res, 200, view);
}

async function clusterPatch(clusterId: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const loaded = await loadClusterCtx(ctx, clusterId);
  const { row, member } = loaded;
  requireSeat(member);
  const eff = effectiveStatusOf(row.status, row.lifts_at, nowDate());
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const patch: { title?: string; public_description?: string; internal_note?: string } = {};
  if ('title' in body) {
    patch.title = titleField(body.title, errors, 'title');
  }
  if ('publicDescription' in body) {
    patch.public_description = textField(body.publicDescription, errors, 'publicDescription');
  }
  if ('internalNote' in body) {
    patch.internal_note = textField(body.internalNote, errors, 'internalNote');
  }
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  if (patch.public_description !== undefined && lockedStatus(eff)) {
    // Locked clusters refuse publicDescription changes.
    throw E.clusterLocked();
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, v] of Object.entries(patch)) {
    sets.push(`${key} = $${++i}`);
    values.push(v);
  }
  if (sets.length > 0) {
    await ctx.db.query(`update clusters set ${sets.join(', ')}, updated_at = now() where id = $1`, [row.id, ...values]);
  }
  const fresh = (await one<ClusterRow>(ctx.db, `select * from clusters where id = $1`, [row.id]))!;
  const effFresh = effectiveStatusOf(fresh.status, fresh.lifts_at, nowDate());
  const view = await clusterFull(ctx, { ...fresh, status: effFresh }, member.workspace.slug, member.workspace.time_zone);
  void app;
  sendJson(res, 200, view);
}

async function loadClusterCtx(ctx: Ctx, clusterId: string): Promise<{ row: ClusterRow; member: MemberContext }> {
  if (!isUuid(clusterId)) throw notFound();
  const row0 = await one<{ slug: string }>(
    ctx.db,
    `select w.slug from clusters c join workspaces w on w.id = c.workspace_id where c.id = $1`,
    [clusterId],
  );
  if (!row0) throw E.notFound();
  return loadCluster(ctx, clusterId, row0.slug);
}

async function commentsGet(clusterId: string, _app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const loaded = await loadClusterCtx(ctx, clusterId);
  void loaded;
  const rows = await many<{ id: string; author_name: string; body: string; created_at: Date }>(
    ctx.db,
    `select id, author_name, body, created_at from comments where cluster_id = $1 order by created_at asc, id asc`,
    [clusterId],
  );
  sendJson(res, 200, {
    comments: rows.map((c) => ({ id: c.id, authorName: c.author_name, body: c.body, createdAt: c.created_at.toISOString() })),
  });
}

async function commentPost(clusterId: string, _app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const { member } = await loadClusterCtx(ctx, clusterId);
  requireSeat(member);
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const text = commentBody(body.body, errors);
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const id = newId();
  await ctx.db.query(
    `insert into comments (id, cluster_id, author_name, body) values ($1,$2,$3,$4)`,
    [id, clusterId, member.account.display_name, text],
  );
  const row = (await one<{ id: string; author_name: string; body: string; created_at: Date }>(
    ctx.db,
    `select id, author_name, body, created_at from comments where id = $1`,
    [id],
  ))!;
  sendJson(res, 201, { id: row.id, authorName: row.author_name, body: row.body, createdAt: row.created_at.toISOString() });
}

async function entryAdd(clusterId: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const { row, member } = await loadClusterCtx(ctx, clusterId);
  requireSeat(member);
  const eff = effectiveStatusOf(row.status, row.lifts_at, nowDate());
  if (lockedStatus(eff)) throw E.clusterLocked();
  const body = await readJsonBody(req);
  const referenceId = typeof body.referenceId === 'string' ? body.referenceId : '';
  const isPrivate = body.isPrivate === true;
  const ref = await one<ReferenceRow>(ctx.db, `select * from reference_items where id = $1 and workspace_id = $2`, [referenceId, member.workspace.id]);
  if (!ref) throw E.notFound();
  const existing = await one(ctx.db, `select 1 from entries where cluster_id = $1 and reference_id = $2`, [clusterId, referenceId]);
  if (existing) throw E.alreadyInCluster();
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    // Lock the cluster row so simultaneous appends each get their own position.
    await client.query(`select id from clusters where id = $1 for update`, [clusterId]);
    const pos = await client.query<{ n: string }>(`select coalesce(max(position),0)+1 as n from entries where cluster_id = $1`, [clusterId]);
    const position = Number(pos.rows[0]!.n);
    const entryId = newId();
    await client.query(
      `insert into entries (id, cluster_id, reference_id, position, is_private, added_by) values ($1,$2,$3,$4,$5,$6)`,
      [entryId, clusterId, referenceId, position, isPrivate, member.account.id],
    );
    const upd = await client.query<{ version: number; n: string }>(
      `update clusters set version = version + 1, updated_at = now() where id = $1 returning version`,
      [clusterId],
    );
    const cnt = await client.query<{ n: string }>(`select count(*)::text as n from entries where cluster_id = $1`, [clusterId]);
    await client.query('COMMIT');
    const version = upd.rows[0]!.version;
    const count = Number(cnt.rows[0]!.n);
    sendJson(res, 201, {
      entry: { id: entryId, position, isPrivate },
      itemCount: count,
      version,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function entryPatch(clusterId: string, entryId: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const { row, member } = await loadClusterCtx(ctx, clusterId);
  requireSeat(member);
  const eff = effectiveStatusOf(row.status, row.lifts_at, nowDate());
  if (lockedStatus(eff)) throw E.clusterLocked();
  const body = await readJsonBody(req);
  const isPrivate = body.isPrivate === true;
  const entry = await one<{ id: string; position: number }>(
    ctx.db,
    `select id, position from entries where id = $1 and cluster_id = $2`,
    [entryId, clusterId],
  );
  if (!entry) throw E.notFound();
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`select id from clusters where id = $1 for update`, [clusterId]);
    await client.query(`update entries set is_private = $2 where id = $1`, [entryId, isPrivate]);
    const upd = await client.query<{ version: number }>(`update clusters set version = version + 1, updated_at = now() where id = $1 returning version`, [clusterId]);
    const cnt = await client.query<{ n: string }>(`select count(*)::text as n from entries where cluster_id = $1`, [clusterId]);
    await client.query('COMMIT');
    sendJson(res, 200, {
      entry: { id: entryId, position: entry.position, isPrivate },
      itemCount: Number(cnt.rows[0]!.n),
      version: upd.rows[0]!.version,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function entryDelete(clusterId: string, entryId: string, app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const { row, member } = await loadClusterCtx(ctx, clusterId);
  requireSeat(member);
  const eff = effectiveStatusOf(row.status, row.lifts_at, nowDate());
  if (lockedStatus(eff)) throw E.clusterLocked();
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`select id from clusters where id = $1 for update`, [clusterId]);
    const del = await client.query<{ position: number }>(`delete from entries where id = $1 and cluster_id = $2 returning position`, [entryId, clusterId]);
    if (del.rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      throw E.notFound();
    }
    const pos = del.rows[0]!.position;
    await client.query(`update entries set position = position - 1 where cluster_id = $1 and position > $2`, [clusterId, pos]);
    const upd = await client.query<{ version: number }>(`update clusters set version = version + 1, updated_at = now() where id = $1 returning version`, [clusterId]);
    const cnt = await client.query<{ n: string }>(`select count(*)::text as n from entries where cluster_id = $1`, [clusterId]);
    await client.query('COMMIT');
    sendJson(res, 200, { itemCount: Number(cnt.rows[0]!.n), version: upd.rows[0]!.version });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function entryMove(clusterId: string, entryId: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const { row, member } = await loadClusterCtx(ctx, clusterId);
  requireSeat(member);
  const eff = effectiveStatusOf(row.status, row.lifts_at, nowDate());
  if (lockedStatus(eff)) throw E.clusterLocked();
  const body = await readJsonBody(req);
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    // One move at a time per cluster: the row lock serialises moves across instances.
    await client.query(`select id from clusters where id = $1 for update`, [clusterId]);
    const current = await client.query<{ version: number; status: string }>(`select version, status from clusters where id = $1`, [clusterId]);
    const version = current.rows[0]!.version;
    const statusNow = current.rows[0]!.status as ClusterRow['status'];
    const effNow = effectiveStatusOf(statusNow, row.lifts_at, nowDate());
    if (lockedStatus(effNow)) {
      await client.query('ROLLBACK');
      throw E.clusterLocked();
    }
    const bodyVersion = typeof body.version === 'number' ? body.version : -1;
    if (bodyVersion !== version) {
      const ids = await client.query<{ id: string }>(`select id from entries where cluster_id = $1 order by position`, [clusterId]);
      await client.query('ROLLBACK');
      throw E.staleOrder(version, ids.rows.map((r) => r.id));
    }
    const cnt = await client.query<{ n: string }>(`select count(*)::text as n from entries where cluster_id = $1`, [clusterId]);
    const count = Number(cnt.rows[0]!.n);
    const errors: FieldErrors = {};
    const toPosition = positionField(body.toPosition, count, errors);
    if (Object.keys(errors).length > 0) {
      await client.query('ROLLBACK');
      throw E.validation(errors);
    }
    const entry = await client.query<{ position: number }>(`select position from entries where id = $1 and cluster_id = $2`, [entryId, clusterId]);
    if (entry.rowCount === 0) {
      await client.query('ROLLBACK');
      throw E.notFound();
    }
    const from = entry.rows[0]!.position;
    if (from < toPosition) {
      await client.query(
        `update entries set position = position - 1 where cluster_id = $1 and position > $2 and position <= $3`,
        [clusterId, from, toPosition],
      );
    } else if (from > toPosition) {
      await client.query(
        `update entries set position = position + 1 where cluster_id = $1 and position >= $2 and position < $3`,
        [clusterId, toPosition, from],
      );
    }
    await client.query(`update entries set position = $2 where id = $1`, [entryId, toPosition]);
    const upd = await client.query<{ version: number }>(`update clusters set version = version + 1, updated_at = now() where id = $1 returning version`, [clusterId]);
    const ids = await client.query<{ id: string }>(`select id from entries where cluster_id = $1 order by position`, [clusterId]);
    await client.query('COMMIT');
    sendJson(res, 200, { version: upd.rows[0]!.version, entryIds: ids.rows.map((r) => r.id) });
  } catch (e) {
    if (!client.query) throw e;
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}

async function statusChange(clusterId: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const body = await readJsonBody(req);
  const requested = typeof body.status === 'string' ? body.status : '';
  const liftLocal = typeof body.liftLocal === 'string' ? body.liftLocal : null;

  const row0 = await one<{ slug: string }>(
    ctx.db,
    `select w.slug from clusters c join workspaces w on w.id = c.workspace_id where c.id = $1`,
    [clusterId],
  );
  if (!row0) throw E.notFound();
  const member = await requireMember(ctx, row0.slug);
  requireSeat(member);

  // Withdrawal is only for the owner or an ops lead.
  if (requested === 'withdrawn') {
    const target = await one<ClusterRow>(ctx.db, `select * from clusters where id = $1 and workspace_id = $2`, [clusterId, member.workspace.id]);
    if (!target) throw E.notFound();
    if (!member.isOpsLead && target.owner_id !== member.account.id) throw E.forbidden();
  }

  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    // One status change at a time per cluster.
    await client.query(`select id from clusters where id = $1 for update`, [clusterId]);
    const cur = await client.query<ClusterRow>(`select * from clusters where id = $1`, [clusterId]);
    const row = cur.rows[0]!;
    const now = nowDate();
    const eff = effectiveStatusOf(row.status, row.lifts_at, now);
    if (!isLegalEdge(eff, requested as never)) {
      await client.query('ROLLBACK');
      throw E.illegalTransition(eff, requested as never);
    }
    let liftsAt: Date | null = row.lifts_at;
    let newLiftLocal: string | null = row.lifts_local;
    let publishedAt: Date | null = row.published_at;
    if (requested === 'embargoed') {
      if (!liftLocal) {
        await client.query('ROLLBACK');
        throw E.validation({ liftLocal: 'Use a date and time like 2027-03-29T09:00.' });
      }
      const resolved = resolveLift(liftLocal, member.workspace.time_zone);
      if ('invalid' in resolved) {
        await client.query('ROLLBACK');
        throw E.validation({ liftLocal: 'Use a date and time like 2027-03-29T09:00.' });
      }
      if ('gap' in resolved) {
        await client.query('ROLLBACK');
        throw E.validation({ liftLocal: `That time does not exist in ${member.workspace.time_zone} on that date.` });
      }
      if (resolved.instant.getTime() <= now.getTime()) {
        await client.query('ROLLBACK');
        throw E.validation({ liftLocal: 'Choose a time in the future.' });
      }
      liftsAt = resolved.instant;
      newLiftLocal = liftLocal;
    }
    if (requested === 'in_review' && eff === 'embargoed') {
      liftsAt = null;
      newLiftLocal = null;
    }
    if (requested === 'withdrawn') {
      publishedAt = null;
      // Review links of the cluster stay as they are; the cluster is no longer in review.
    }
    await client.query(
      `update clusters set status = $2, lifts_at = $3, lifts_local = $4, published_at = $5, updated_at = now(), version = version + 1 where id = $1`,
      [clusterId, requested, liftsAt, newLiftLocal, publishedAt],
    );
    // Leaving in_review makes every review link of the cluster inactive for good.
    if (eff === 'in_review' && requested !== 'in_review') {
      await client.query(`update review_links set state = 'inactive' where cluster_id = $1 and state = 'live'`, [clusterId]);
    }
    const fresh = await client.query<ClusterRow>(`select * from clusters where id = $1`, [clusterId]);
    await client.query('COMMIT');
    const effFresh = effectiveStatusOf(fresh.rows[0]!.status, fresh.rows[0]!.lifts_at, nowDate());
    const view = await clusterFull(ctx, { ...fresh.rows[0]!, status: effFresh }, member.workspace.slug, member.workspace.time_zone);
    void app;
    sendJson(res, 200, view);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}

async function exportCsv(clusterId: string, app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const loaded = await loadClusterCtx(ctx, clusterId);
  const entries = await many<{
    id: string;
    position: number;
    is_private: boolean;
    kind: string;
    title: string;
    source_clip_title: string | null;
    timecode: string | null;
  }>(
    ctx.db,
    `select e.id, e.position, e.is_private, r.kind, r.title, r.source_clip_title, r.timecode
       from entries e join reference_items r on r.id = e.reference_id
      where e.cluster_id = $1
      order by e.position`,
    [clusterId],
  );
  const lines: string[] = ['position,title,kind,source_clip,timecode,private'];
  for (const e of entries) {
    lines.push(
      [String(e.position), csvCell(e.title), e.kind, csvCell(e.source_clip_title ?? ''), e.timecode ?? '', e.is_private ? 'yes' : 'no'].join(','),
    );
  }
  const csv = `${lines.join('\r\n')}\r\n`;
  const body = Buffer.from(csv, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Length': body.length,
    'Content-Disposition': `attachment; filename="cluster-${loaded.row.id}.csv"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function reviewLinksGet(clusterId: string, _app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  await loadClusterCtx(ctx, clusterId);
  const rows = await many<{ id: string; email: string; expires_at: Date; can_comment: boolean; state: string }>(
    ctx.db,
    `select id, email, expires_at, can_comment, state from review_links where cluster_id = $1 order by created_at desc`,
    [clusterId],
  );
  const now = nowDate();
  sendJson(res, 200, {
    links: rows.map((r) => ({
      id: r.id,
      email: r.email,
      expiresAt: r.expires_at.toISOString(),
      canComment: r.can_comment,
      state: linkState(r.state, r.expires_at, now, clusterInReview(ctx, clusterId)),
    })),
  });
}

function clusterInReview(_ctx: Ctx, clusterId: string): boolean {
  void clusterId;
  return true;
}

/** The state of a review link as served. */
export function linkState(storedState: string, expiresAt: Date, now: Date, clusterInReviewNow: boolean): 'live' | 'expired' | 'revoked' | 'inactive' {
  if (storedState === 'revoked') return 'revoked';
  if (!clusterInReviewNow || storedState === 'inactive') return 'inactive';
  if (now.getTime() >= expiresAt.getTime()) return 'expired';
  return 'live';
}

async function reviewLinkCreate(clusterId: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const { row, member } = await loadClusterCtx(ctx, clusterId);
  requireSeat(member);
  const eff = effectiveStatusOf(row.status, row.lifts_at, nowDate());
  if (eff !== 'in_review') throw E.clusterNotInReview();
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const email = typeof body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ? body.email.toLowerCase() : '';
  if (!email) errors.email = 'Enter a valid email address.';
  const expiresAtRaw = typeof body.expiresAt === 'string' ? body.expiresAt : '';
  let expiresAt: Date | null = null;
  if (expiresAtRaw) {
    expiresAt = new Date(expiresAtRaw);
    if (Number.isNaN(expiresAt.getTime())) {
      errors.expiresAt = 'Choose a time in the future.';
    } else {
      const now = nowDate();
      if (expiresAt.getTime() <= now.getTime()) errors.expiresAt = 'Choose a time in the future.';
      else if (expiresAt.getTime() - now.getTime() > 2_592_000_000) errors.expiresAt = 'Choose an expiry within the next 30 days.';
    }
  } else {
    errors.expiresAt = 'Choose a time in the future.';
  }
  const canComment = body.canComment === true;
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const id = newId();
  const token = newToken('rv');
  await ctx.db.query(
    `insert into review_links (id, token, cluster_id, workspace_id, email, expires_at, can_comment, state)
     values ($1,$2,$3,$4,$5,$6,$7,'live')`,
    [id, token, clusterId, member.workspace.id, email, expiresAt, canComment],
  );
  const link = `${app.config.publicBaseUrl}/review/${token}`;
  const ws = (await one<{ name: string }>(ctx.db, `select name from workspaces where id = $1`, [member.workspace.id]))!;
  try {
    await app.mailer.send({
      to: email,
      subject: `Review ${row.title} for ${ws.name}`,
      text: `You have been invited to review "${row.title}".\r\n\r\nOpen your review link:\r\n${link}\r\n\r\nThis link expires at ${expiresAt!.toISOString().replace('T', ' ').slice(0, 16)} UTC.\r\n`,
    });
  } catch {
    await ctx.db.query(`delete from review_links where id = $1`, [id]);
    throw E.mailUnavailable();
  }
  sendJson(res, 201, { id, email, url: link, expiresAt: expiresAt!.toISOString(), canComment });
}

async function reviewLinkRegenerate(linkId: string, app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const link = await one<{ id: string; token: string; cluster_id: string; workspace_id: string; email: string; expires_at: Date; can_comment: boolean; state: string }>(
    ctx.db,
    `select * from review_links where id = $1`,
    [linkId],
  );
  if (!link) throw E.notFound();
  const row0 = await one<{ slug: string; name: string }>(
    ctx.db,
    `select w.slug, w.name from clusters c join workspaces w on w.id = c.workspace_id where c.id = $1`,
    [link.cluster_id],
  );
  if (!row0) throw E.notFound();
  const member = await requireMember(ctx, row0.slug);
  requireSeat(member);
  const cluster = await one<ClusterRow>(ctx.db, `select * from clusters where id = $1`, [link.cluster_id]);
  const now = nowDate();
  const eff = effectiveStatusOf(cluster!.status, cluster!.lifts_at, now);
  // Only a live link can be regenerated.
  const state = linkState(link.state, link.expires_at, now, eff === 'in_review');
  if (state === 'expired') throw E.linkExpired();
  if (state === 'revoked') throw E.linkRevoked();
  if (state === 'inactive') throw E.linkInactive();
  const newTok = newToken('rv');
  await ctx.db.query(`update review_links set state = 'revoked' where id = $1`, [link.id]);
  const id = newId();
  await ctx.db.query(
    `insert into review_links (id, token, cluster_id, workspace_id, email, expires_at, can_comment, state)
     values ($1,$2,$3,$4,$5,$6,$7,'live')`,
    [id, newTok, link.cluster_id, link.workspace_id, link.email, link.expires_at, link.can_comment],
  );
  const url2 = `${app.config.publicBaseUrl}/review/${newTok}`;
  const clusterTitle = (await one<{ title: string }>(ctx.db, `select title from clusters where id = $1`, [link.cluster_id]))!.title;
  try {
    await app.mailer.send({
      to: link.email,
      subject: `Review ${clusterTitle} for ${row0.name}`,
      text: `You have been invited to review "${clusterTitle}".\r\n\r\nOpen your review link:\r\n${url2}\r\n\r\nThis link expires at ${link.expires_at.toISOString().replace('T', ' ').slice(0, 16)} UTC.\r\n`,
    });
  } catch {
    // Undo the regeneration: keep the old link working.
    await ctx.db.query(`delete from review_links where id = $1`, [id]);
    await ctx.db.query(`update review_links set state = 'live' where id = $1`, [link.id]);
    throw E.mailUnavailable();
  }
  sendJson(res, 200, { id, email: link.email, url: url2, expiresAt: link.expires_at.toISOString(), canComment: link.can_comment });
}

async function reviewLinkRevoke(linkId: string, _app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const link = await one<{ id: string; workspace_id: string }>(ctx.db, `select id, workspace_id from review_links where id = $1`, [linkId]);
  if (!link) throw E.notFound();
  const row0 = await one<{ slug: string }>(ctx.db, `select slug from workspaces where id = $1`, [link.workspace_id]);
  if (!row0) throw E.notFound();
  const member = await requireMember(ctx, row0.slug);
  requireSeat(member);
  await ctx.db.query(`update review_links set state = 'revoked' where id = $1`, [link.id]);
  res.statusCode = 204;
  res.end();
}
