// Workspace endpoints: the wall's references, search, the cluster list, seats,
// the plan, invites and collaborator offboarding.

import http from 'node:http';
import type { URL } from 'node:url';
import type { App, Ctx, Handler } from '../app.js';
import { sendJson, readJsonBody } from '../http-helpers.js';
import { one, many } from '../db.js';
import { E } from '../e.js';
import { isUuid } from '../ids.js';
import { notFound } from '../errors.js';
import { requireMember, requireOpsLead, requireSeat } from '../context.js';
import type { MemberContext } from '../context.js';
import { referenceView, summaryView, type ClusterRow, type PersonRow, type ReferenceRow } from '../projections.js';
import { queryField, type FieldErrors, validEmail, nameField, codePoints } from '../validate.js';
import { escapeRegExp } from '../../shared/domain.js';
import { ALL_PLANS, PLAN_NAMES } from '../../shared/constants.js';
import { planNameOf, seatCapOf, monthlyPriceOf } from '../../shared/domain.js';
import { encodeCursor, decodeCursor } from '../cursors.js';
import { objectKey } from '../objects.js';
import { sniffKind, scrub, CONTENT_TYPES, EXTENSIONS } from '../services/media.js';
import { IMAGE_LIMIT, CLIP_LIMIT, parseMultipart, readBody } from '../boundary.js';
import { totalFramesOf, timecodeOf, stillDefaultTitle } from '../../shared/domain.js';
import { newToken, newId } from '../passwords.js';

export function workspaceRoutes(method: string, pathname: string): Handler | null {
  if (method === 'GET' && /^\/api\/workspaces\/[^/]+$/.test(pathname)) return workspaceInfo;
  if (method === 'GET' && /^\/api\/workspaces\/[^/]+\/seats$/.test(pathname)) return seatsGet;
  if (method === 'POST' && /^\/api\/workspaces\/[^/]+\/seats$/.test(pathname)) return seatAssign;
  if (method === 'DELETE' && /^\/api\/workspaces\/[^/]+\/seats\/[^/]+$/.test(pathname)) return seatFree;
  if (method === 'GET' && /^\/api\/workspaces\/[^/]+\/plan$/.test(pathname)) return planGet;
  if (method === 'POST' && /^\/api\/workspaces\/[^/]+\/plan$/.test(pathname)) return planUpgrade;
  if (method === 'POST' && /^\/api\/workspaces\/[^/]+\/invites$/.test(pathname)) return inviteCreate;
  if (method === 'POST' && /^\/api\/workspaces\/[^/]+\/collaborators\/offboard$/.test(pathname)) return offboard;
  if (method === 'GET' && /^\/api\/workspaces\/[^/]+\/references$/.test(pathname)) return referencesList;
  if (method === 'POST' && /^\/api\/workspaces\/[^/]+\/references$/.test(pathname)) return referenceUpload;
  if (method === 'DELETE' && /^\/api\/workspaces\/[^/]+\/references\/[^/]+$/.test(pathname)) return referenceDelete;
  if (method === 'POST' && /^\/api\/workspaces\/[^/]+\/clips\/[^/]+\/stills$/.test(pathname)) return stillPluck;
  if (method === 'GET' && /^\/api\/workspaces\/[^/]+\/search$/.test(pathname)) return search;
  if (method === 'GET' && /^\/api\/workspaces\/[^/]+\/clusters$/.test(pathname)) return clustersList;
  if (method === 'POST' && /^\/api\/workspaces\/[^/]+\/clusters$/.test(pathname)) return clusterCreate;
  return null;
}

function wsSlug(pathname: string): string {
  return pathname.split('/')[3]!;
}

/** The plan state as Kill Bill reports it, recorded on every successful read. */
export async function currentPlan(app: App, slug: string): Promise<{ plan: string; planName: string; seatCap: number }> {
  const read = await app.kbSync.readPlan(slug);
  if (read) {
    return { plan: read.plan, planName: planNameOf(read.plan), seatCap: seatCapOf(read.plan) };
  }
  const recorded = await one<{ plan: string }>(app.db, `select plan from seat_state s join workspaces w on w.id = s.workspace_id where w.slug = $1`, [slug]);
  const plan = recorded?.plan ?? 'rushes-pro-5';
  return { plan, planName: planNameOf(plan), seatCap: seatCapOf(plan) };
}

export async function seatsUsedOf(db: Ctx['db'], workspaceId: string): Promise<number> {
  const r = await one<{ n: string }>(db, `select count(*)::text as n from accounts where workspace_id = $1 and has_seat`, [workspaceId]);
  return Number(r?.n ?? 0);
}

async function workspaceInfo(app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireMember(ctx, slug);
  const plan = await currentPlan(app, slug);
  const seatsUsed = await seatsUsedOf(ctx.db, member.workspace.id);
  sendJson(res, 200, {
    slug: member.workspace.slug,
    name: member.workspace.name,
    timeZone: member.workspace.time_zone,
    plan: plan.plan,
    planName: plan.planName,
    seatCap: plan.seatCap,
    seatsUsed,
  });
}

async function seatsGet(app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireOpsLead(ctx, slug);
  const plan = await currentPlan(app, slug);
  const seatsUsed = await seatsUsedOf(ctx.db, member.workspace.id);
  const rows = await many<{ id: string; display_name: string; email: string; handle: string; has_seat: boolean }>(
    ctx.db,
    `select id, display_name, email, handle, has_seat from accounts where workspace_id = $1 and role = 'designer' order by display_name`,
    [member.workspace.id],
  );
  sendJson(res, 200, {
    plan: plan.plan,
    seatCap: plan.seatCap,
    seatsUsed,
    members: rows.map((r) => ({ id: r.id, displayName: r.display_name, email: r.email, handle: r.handle, hasSeat: r.has_seat })),
  });
}

async function seatAssign(app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireOpsLead(ctx, slug);
  const body = await readJsonBody(req);
  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  const target = await one<{ id: string; has_seat: boolean; workspace_id: string; role: string }>(
    ctx.db,
    `select id, has_seat, workspace_id, role from accounts where id = $1`,
    [memberId],
  );
  if (!target || target.role !== 'designer' || target.workspace_id !== member.workspace.id) throw E.notFound();
  const plan = await currentPlan(app, slug);
  const seatsUsed = await seatsUsedOf(ctx.db, member.workspace.id);
  if (target.has_seat) {
    sendJson(res, 200, { memberId, seatsUsed, seatCap: plan.seatCap });
    return;
  }
  // Atomically claim a seat: only succeed while used < cap.
  const upd = await ctx.db.query<{ ok: boolean }>(
    `update accounts set has_seat = true
      where id = $1 and workspace_id = $2
        and (select count(*) from accounts a2 where a2.workspace_id = $2 and a2.has_seat) < $3
      returning true as ok`,
    [memberId, member.workspace.id, plan.seatCap],
  );
  if (upd.rowCount === 0) throw E.noSeatsLeft();
  const used = await seatsUsedOf(ctx.db, member.workspace.id);
  sendJson(res, 201, { memberId, seatsUsed: used, seatCap: plan.seatCap });
}

async function seatFree(app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const parts = url.pathname.split('/');
  const slug = parts[3]!;
  const memberId = parts[5]!;
  if (!isUuid(memberId)) throw notFound();
  const member = await requireOpsLead(ctx, slug);
  const target = await one<{ id: string; workspace_id: string; role: string }>(
    ctx.db,
    `select id, workspace_id, role from accounts where id = $1`,
    [memberId],
  );
  if (!target || target.role !== 'designer' || target.workspace_id !== member.workspace.id) throw E.notFound();
  await ctx.db.query(`update accounts set has_seat = false where id = $1 and workspace_id = $2`, [memberId, member.workspace.id]);
  const plan = await currentPlan(app, slug);
  const used = await seatsUsedOf(ctx.db, member.workspace.id);
  sendJson(res, 200, { memberId, seatsUsed: used, seatCap: plan.seatCap });
}

async function planGet(app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireOpsLead(ctx, slug);
  const plan = await currentPlan(app, slug);
  const seatsUsed = await seatsUsedOf(ctx.db, member.workspace.id);
  const upgrades = ALL_PLANS.filter((p) => seatCapOf(p) > plan.seatCap).map((p) => ({
    plan: p,
    planName: planNameOf(p),
    seatCap: seatCapOf(p),
    monthlyPrice: monthlyPriceOf(p),
  }));
  sendJson(res, 200, {
    plan: plan.plan,
    planName: plan.planName,
    seatCap: plan.seatCap,
    seatsUsed,
    monthlyPrice: monthlyPriceOf(plan.plan),
    currency: 'USD',
    upgrades,
  });
}

async function planUpgrade(app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireOpsLead(ctx, slug);
  const key = req.headers['idempotency-key'];
  const errors: FieldErrors = {};
  const idempotencyKey = typeof key === 'string' ? key : '';
  const body = await readJsonBody(req);
  const planRequested = typeof body.plan === 'string' ? body.plan : '';
  const requestBody = { plan: planRequested };

  // Idempotency records come before any state or validation check.
  const stored = await one<{ status: string; request_body: unknown; response: unknown }>(
    ctx.db,
    `select status, request_body, response from idempotency_keys where workspace_id = $1 and key = $2`,
    [member.workspace.id, idempotencyKey],
  );
  if (stored && stored.status === 'done') {
    if (JSON.stringify(stored.request_body) !== JSON.stringify(requestBody)) throw E.idempotencyConflict();
    sendJson(res, 200, stored.response);
    return;
  }
  if (stored && stored.status === 'running') {
    if (JSON.stringify(stored.request_body) !== JSON.stringify(requestBody)) throw E.idempotencyConflict();
    throw E.idempotencyInProgress();
  }
  const inserted = await ctx.db.query(
    `insert into idempotency_keys (workspace_id, key, status, request_body) values ($1,$2,'running',$3::jsonb)
     on conflict (workspace_id, key) do nothing`,
    [member.workspace.id, idempotencyKey, JSON.stringify(requestBody)],
  );
  if (inserted.rowCount === 0) {
    const again = await one<{ status: string; request_body: unknown; response: unknown }>(
      ctx.db,
      `select status, request_body, response from idempotency_keys where workspace_id = $1 and key = $2`,
      [member.workspace.id, idempotencyKey],
    );
    if (!again) throw E.billingUnavailable();
    if (again.status === 'done') {
      if (JSON.stringify(again.request_body) !== JSON.stringify(requestBody)) throw E.idempotencyConflict();
      sendJson(res, 200, again.response);
      return;
    }
    throw E.idempotencyInProgress();
  }

  try {
    await performUpgrade(app, ctx, member, res, idempotencyKey, requestBody);
  } catch (e) {
    // Failed attempts are not stored.
    await ctx.db.query(`delete from idempotency_keys where workspace_id = $1 and key = $2 and status = 'running'`, [
      member.workspace.id,
      idempotencyKey,
    ]);
    throw e;
  }
}

async function performUpgrade(
  app: App,
  ctx: Ctx,
  member: MemberContext,
  res: http.ServerResponse,
  idempotencyKey: string,
  requestBody: { plan: string },
): Promise<void> {
  const errors: FieldErrors = {};
  if (codePoints(idempotencyKey) < 1 || codePoints(idempotencyKey) > 64) {
    errors.idempotencyKey = 'Send an Idempotency-Key of 1 to 64 characters.';
  }
  const plan = requestBody.plan;
  if (!plan) errors.plan = 'Choose a plan to upgrade to.';
  else if (!(PLAN_NAMES[plan])) errors.plan = 'Unknown plan.';
  if (Object.keys(errors).length > 0) {
    // delete the running marker before answering with validation
    await ctx.db.query(`delete from idempotency_keys where workspace_id = $1 and key = $2 and status = 'running'`, [
      member.workspace.id,
      idempotencyKey,
    ]);
    throw E.validation(errors);
  }
  const before = await currentPlan(app, member.workspace.slug);
  if (seatCapOf(plan) <= before.seatCap) {
    await ctx.db.query(`delete from idempotency_keys where workspace_id = $1 and key = $2 and status = 'running'`, [
      member.workspace.id,
      idempotencyKey,
    ]);
    throw E.validation({ plan: 'Choose a larger plan than the current one.' });
  }

  const sub = await app.killbill.findSubscription(member.workspace.slug);
  if (!sub) throw E.billingUnavailable();
  // 1. Change the subscription.
  await app.killbill.changePlan(sub.subscriptionId, plan);
  // 2. Read the subscription back.
  const after = await app.killbill.readPlan(member.workspace.slug);
  const newPlan = after?.plan ?? plan;
  // 3. Send the receipt.
  const seatsUsed = await seatsUsedOf(ctx.db, member.workspace.id);
  try {
    await app.mailer.send({
      to: member.account.email,
      subject: `Rushes receipt: ${member.workspace.name} is now on ${planNameOf(newPlan)}`,
      text: [
        `${member.workspace.name} has a new plan.`,
        ``,
        `Plan: ${planNameOf(newPlan)}`,
        `Seats: ${seatCapOf(newPlan)}`,
        `Monthly price: $${monthlyPriceOf(newPlan)}`,
      ].join('\r\n'),
    });
  } catch {
    // Undo: change the subscription back, leave the cap alone.
    await app.killbill.changePlan(sub.subscriptionId, before.plan).catch(() => {});
    throw E.mailUnavailable();
  }
  // 4. Record the new cap.
  await app.kbSync.recordPlan(member.workspace.slug, newPlan);
  const response = {
    plan: newPlan,
    planName: planNameOf(newPlan),
    seatCap: seatCapOf(newPlan),
    seatsUsed,
    monthlyPrice: monthlyPriceOf(newPlan),
    currency: 'USD',
    receiptSentTo: member.account.email,
  };
  await ctx.db.query(
    `update idempotency_keys set status = 'done', response = $3::jsonb where workspace_id = $1 and key = $2`,
    [member.workspace.id, idempotencyKey, JSON.stringify(response)],
  );
  sendJson(res, 200, response);
}

async function inviteCreate(app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireOpsLead(ctx, slug);
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const email = validEmail(body.email, errors).toLowerCase();
  const displayName = nameField(body.displayName, errors, 'displayName');
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const existing = await one(ctx.db, `select 1 from accounts where lower(email) = $1`, [email]);
  if (existing) throw E.validation({ email: 'That email already has an account.' });
  const id = newId();
  const token = newToken('inv');
  await ctx.db.query(
    `insert into invites (id, token, workspace_id, email, display_name) values ($1,$2,$3,$4,$5)`,
    [id, token, member.workspace.id, email, displayName],
  );
  const link = `${app.config.publicBaseUrl}/invite/${token}`;
  try {
    await app.mailer.send({
      to: email,
      subject: `You're invited to ${member.workspace.name} on Rushes`,
      text: `${member.account.display_name} has invited you to ${member.workspace.name} on Rushes.\r\n\r\nAccept your invite here:\r\n${link}\r\n`,
    });
  } catch {
    await ctx.db.query(`delete from invites where id = $1`, [id]);
    throw E.mailUnavailable();
  }
  sendJson(res, 201, { id, email, displayName });
}

async function offboard(_app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireOpsLead(ctx, slug);
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const email = validEmail(body.email, errors).toLowerCase();
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const r = await ctx.db.query<{ id: string }>(
    `update review_links set state = 'revoked'
      where workspace_id = $1 and lower(email) = $2 and state = 'live'
      returning id`,
    [member.workspace.id, email],
  );
  sendJson(res, 200, { email, revoked: r.rowCount ?? 0 });
}

async function referencesList(_app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireMember(ctx, slug);
  const errors: FieldErrors = {};
  const limitRaw = url.searchParams.get('limit');
  let limit = 50;
  if (limitRaw !== null && limitRaw !== '') {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1) {
      throw E.validation({ limit: 'Use a whole number of 1 or more.' });
    }
    limit = Math.min(100, Number(limitRaw));
  }
  const cursor = url.searchParams.get('cursor');
  const payload = decodeCursor({ surface: 'references', workspace: slug }, cursor);
  const before = typeof payload.createdAt === 'string' ? new Date(payload.createdAt) : null;
  const beforeId = typeof payload.id === 'string' ? payload.id : null;
  const rows = await many<ReferenceRow & { slug: string; creator_display: string; creator_handle: string }>(
    ctx.db,
    `select r.*, w.slug, a.display_name as creator_display, a.handle as creator_handle
       from reference_items r
       join workspaces w on w.id = r.workspace_id
       join accounts a on a.id = r.created_by
      where r.workspace_id = $1
        and ($2::timestamptz is null or (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
      order by r.created_at desc, r.id desc
      limit $4`,
    [member.workspace.id, before, beforeId, limit + 1],
  );
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor({ surface: 'references', workspace: slug }, { createdAt: last.created_at.toISOString(), id: last.id }) : null;
  sendJson(res, 200, {
    items: items.map((r) => referenceView(r, { displayName: r.creator_display, handle: r.creator_handle }, r.slug)),
    nextCursor,
  });
}

async function referenceUpload(app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireMember(ctx, slug);
  requireSeat(member);
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) throw E.unsupportedMediaType();
  const raw = await readBody(req, CLIP_LIMIT + 1_048_576);
  const parts = parseMultipart(raw, contentType);
  const file = parts.find((p) => p.name === 'file');
  if (!file) throw E.validation({ file: 'Attach one file.' });
  const fields = new Map(parts.filter((p) => !p.filename).map((p) => [p.name, p.body.toString('utf8')]));
  const kind = sniffKind(file.body);
  if (kind === 'unknown') {
    throw E.unsupportedMediaType();
  }
  const isClip = kind === 'mp4' || kind === 'webm';
  const limit = isClip ? CLIP_LIMIT : IMAGE_LIMIT;
  if (file.body.length > limit) throw E.tooLarge();
  const errors: FieldErrors = {};
  let title = fields.get('title') ?? '';
  if (isClip) {
    if (title.trim().length === 0) errors.title = 'Enter a title of 1 to 80 characters.';
    else if (codePoints(title) > 80) errors.title = 'Enter a title of 1 to 80 characters.';
  } else if (title && codePoints(title) > 80) {
    errors.title = 'Enter a title of 1 to 80 characters.';
  }
  let frameRate = 25;
  let durationMs = 2000;
  if (isClip) {
    const fr = Number(fields.get('frameRate') ?? '');
    if (fr !== 24 && fr !== 25 && fr !== 30) errors.frameRate = 'Choose 24, 25 or 30 frames per second.';
    else frameRate = fr;
    const dur = Number(fields.get('durationMs') ?? '');
    if (!Number.isInteger(dur) || dur < 1 || dur > 3_600_000) errors.durationMs = 'Enter a duration from 1 to 3600000 milliseconds.';
    else durationMs = dur;
  }
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  if (!title) {
    const filename = file.filename ?? 'reference';
    title = filename.replace(/\.[^.]+$/, '') || 'reference';
  }

  const id = newId();
  const key = objectKey(slug, id, EXTENSIONS[kind]!);
  const body = isClip ? file.body : scrub(kind, file.body);
  try {
    await app.storage.put({ key, body, contentType: CONTENT_TYPES[kind]! });
  } catch (e) {
    if (e instanceof E.ApiError) throw e;
    throw E.storageUnavailable();
  }
  const totalFrames = isClip ? totalFramesOf(durationMs, frameRate) : null;
  await ctx.db.query(
    `insert into reference_items (id, workspace_id, kind, title, ext, content_type, frame_rate, duration_ms, total_frames, created_by, stored_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())`,
    [id, member.workspace.id, isClip ? 'clip' : 'image', title, EXTENSIONS[kind]!, CONTENT_TYPES[kind]!, isClip ? frameRate : null, isClip ? durationMs : null, totalFrames, member.account.id],
  );
  const row = (await one<ReferenceRow>(ctx.db, `select * from reference_items where id = $1`, [id]))!;
  sendJson(res, 201, referenceView(row, { displayName: member.account.display_name, handle: member.account.handle }, slug));
}

async function referenceDelete(app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const parts = url.pathname.split('/');
  const slug = parts[3]!;
  const refId = parts[5]!;
  if (!isUuid(refId)) throw notFound();
  const member = await requireMember(ctx, slug);
  requireSeat(member);
  const row = await one<ReferenceRow>(ctx.db, `select * from reference_items where id = $1 and workspace_id = $2`, [refId, member.workspace.id]);
  if (!row) throw E.notFound();
  // A reference inside a locked cluster cannot be deleted.
  const locked = await one<{ n: string }>(
    ctx.db,
    `select count(*)::text as n
       from entries e join clusters c on c.id = e.cluster_id
      where e.reference_id = $1 and c.status in ('embargoed','public','withdrawn')`,
    [refId],
  );
  if (locked && Number(locked.n) > 0) throw E.clusterLocked();
  // Remove its entries from draft and in-review clusters.
  await ctx.db.query(
    `delete from entries where reference_id = $1 and cluster_id in (select id from clusters where status in ('draft','in_review'))`,
    [refId],
  );
  await ctx.db.query(
    `update clusters set version = version + 1, updated_at = now()
      where id in (select distinct cluster_id from entries where reference_id = $1)`,
    [refId],
  );
  await ctx.db.query(`delete from reference_items where id = $1`, [refId]);
  try {
    await app.storage.delete(objectKey(slug, row.id, row.ext));
  } catch (e) {
    if (e instanceof E.ApiError && e.code === 'storage_unavailable') {
      // The row is gone but the object may linger; restore the row to keep one-to-one.
      await ctx.db.query(
        `insert into reference_items (id, workspace_id, kind, title, ext, content_type, frame_rate, duration_ms, total_frames, source_clip_id, source_clip_title, frame_index, timecode, created_by, created_at, stored_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())`,
        [row.id, row.workspace_id, row.kind, row.title, row.ext, row.content_type, row.frame_rate, row.duration_ms, row.total_frames, row.source_clip_id, row.source_clip_title, row.frame_index, row.timecode, row.created_by, row.created_at],
      );
      throw E.storageUnavailable();
    }
    throw e;
  }
  res.statusCode = 204;
  res.end();
}

async function stillPluck(app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const parts = url.pathname.split('/');
  const slug = parts[3]!;
  const clipId = parts[5]!;
  if (!isUuid(clipId)) throw notFound();
  const member = await requireMember(ctx, slug);
  requireSeat(member);
  const clip = await one<ReferenceRow>(ctx.db, `select * from reference_items where id = $1 and workspace_id = $2`, [clipId, member.workspace.id]);
  if (!clip || clip.kind !== 'clip') throw E.notFound();
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) throw E.unsupportedMediaType();
  const raw = await readBody(req, 16_000_000);
  const parts2 = parseMultipart(raw, contentType);
  const still = parts2.find((p) => p.name === 'still');
  if (!still) throw E.validation({ file: 'Attach one file.' });
  const fields = new Map(parts2.filter((p) => !p.filename).map((p) => [p.name, p.body.toString('utf8')]));
  const errors: FieldErrors = {};
  const frameIndexRaw = Number(fields.get('frameIndex') ?? '');
  const totalFrames = clip.total_frames ?? 1;
  if (!Number.isInteger(frameIndexRaw) || frameIndexRaw < 0 || frameIndexRaw > totalFrames - 1) {
    errors.frameIndex = `Choose a frame from 0 to ${totalFrames - 1}.`;
  }
  const clusterId = fields.get('clusterId') ?? '';
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const target = await one<ClusterRow>(ctx.db, `select * from clusters where id = $1 and workspace_id = $2`, [clusterId, member.workspace.id]);
  if (!target) throw E.notFound();
  const effective = target.status;
  if (effective === 'embargoed' || effective === 'public' || effective === 'withdrawn') throw E.clusterLocked();

  const sniffed = sniffKind(still.body);
  if (sniffed !== 'png') throw E.unsupportedMediaType();
  if (still.body.length > 8_000_000) throw E.tooLarge();
  const frameIndex = frameIndexRaw;
  const timecode = timecodeOf(frameIndex, clip.frame_rate ?? 25);
  const id = newId();
  const key = objectKey(slug, id, 'png');
  const body = scrub('png', still.body);
  try {
    await app.storage.put({
      key,
      body,
      contentType: 'image/png',
      metadata: { 'source-clip': clip.id, timecode },
    });
  } catch {
    throw E.storageUnavailable();
  }
  const title = stillDefaultTitle(clip.title, timecode);
  await ctx.db.query(
    `insert into reference_items (id, workspace_id, kind, title, ext, content_type, source_clip_id, source_clip_title, frame_index, timecode, created_by, stored_at)
     values ($1,$2,'still',$3,'png','image/png',$4,$5,$6,$7,$8, now())`,
    [id, member.workspace.id, title, clip.id, clip.title, frameIndex, timecode, member.account.id],
  );
  const entry = await appendEntry(ctx, target.id, id, member.account.id);
  sendJson(res, 201, {
    reference: referenceView(
      (await one<ReferenceRow>(ctx.db, `select * from reference_items where id = $1`, [id]))!,
      { displayName: member.account.display_name, handle: member.account.handle },
      slug,
    ),
    entry: { id: entry.id, position: entry.position, isPrivate: entry.is_private },
    cluster: { id: target.id, itemCount: entry.count, version: entry.version },
  });
}

async function appendEntry(ctx: Ctx, clusterId: string, referenceId: string, addedBy: string): Promise<{ id: string; position: number; is_private: boolean; count: number; version: number }> {
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query<{ id: string; is_private: boolean; n: string; version: number }>(
      `insert into entries (id, cluster_id, reference_id, position, is_private, added_by)
       values ($1, $2, $3, (select coalesce(max(position),0)+1 from entries where cluster_id = $2), false, $4)
       returning id, is_private`,
      [newId(), clusterId, referenceId, addedBy],
    );
    const upd = await client.query<{ version: number; n: string }>(
      `update clusters set version = version + 1, updated_at = now() where id = $1 returning version`,
      [clusterId],
    );
    const cnt = await client.query<{ n: string }>(`select count(*)::text as n from entries where cluster_id = $1`, [clusterId]);
    await client.query('COMMIT');
    return {
      id: row.rows[0]!.id,
      position: Number(cnt.rows[0]!.n),
      is_private: row.rows[0]!.is_private,
      count: Number(cnt.rows[0]!.n),
      version: upd.rows[0]!.version,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
}

async function search(_app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireMember(ctx, slug);
  const q = url.searchParams.get('q') ?? '';
  const errors: FieldErrors = {};
  queryField(q, errors);
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const pattern = `%${escapeLike(q)}%`;
  const clusters = await many<ClusterRow & { n: string }>(
    ctx.db,
    `select c.*, (select count(*)::text as n from entries e where e.cluster_id = c.id) as n
       from clusters c
      where c.workspace_id = $1 and c.title ilike $2
      order by c.updated_at desc
      limit 20`,
    [member.workspace.id, pattern],
  );
  const refs = await many<ReferenceRow & { slug: string; creator_display: string; creator_handle: string }>(
    ctx.db,
    `select r.*, w.slug, a.display_name as creator_display, a.handle as creator_handle
       from reference_items r
       join workspaces w on w.id = r.workspace_id
       join accounts a on a.id = r.created_by
      where r.workspace_id = $1
        and (r.title ilike $2 or (r.kind = 'still' and r.source_clip_title ilike $2))
      order by r.created_at desc
      limit 20`,
    [member.workspace.id, pattern],
  );
  const clusterCount = await one<{ n: string }>(
    ctx.db,
    `select count(*)::text as n from clusters c where c.workspace_id = $1 and c.title ilike $2`,
    [member.workspace.id, pattern],
  );
  const refCount = await one<{ n: string }>(
    ctx.db,
    `select count(*)::text as n from reference_items r
      where r.workspace_id = $1
        and (r.title ilike $2 or (r.kind = 'still' and r.source_clip_title ilike $2))`,
    [member.workspace.id, pattern],
  );
  sendJson(res, 200, {
    query: q,
    counts: { clusters: Number(clusterCount?.n ?? 0), references: Number(refCount?.n ?? 0) },
    clusters: clusters.map((c) => ({ id: c.id, title: c.title, status: c.status, itemCount: Number(c.n) })),
    references: refs.map((r) => referenceView(r, { displayName: r.creator_display, handle: r.creator_handle }, r.slug)),
  });
}

function escapeLike(q: string): string {
  return q.replace(/[%_\\]/g, (c) => `\\${c}`);
}

async function clustersList(_app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireMember(ctx, slug);
  const q = url.searchParams.get('q');
  if (q !== null) {
    const errors: FieldErrors = {};
    queryField(q, errors);
    if (Object.keys(errors).length > 0) throw E.validation(errors);
  }
  const pattern = q === null ? null : `%${escapeLike(q)}%`;
  const rows = await many<ClusterRow & { n: string; total: string }>(
    ctx.db,
    `select c.*, (select count(*)::text as n from entries e where e.cluster_id = c.id) as n,
            (select count(*)::text as total from clusters c2 where c2.workspace_id = $1 and ($2::text is null or c2.title ilike $2)) as total
       from clusters c
      where c.workspace_id = $1 and ($2::text is null or c.title ilike $2)
      order by c.updated_at desc
      limit 20`,
    [member.workspace.id, pattern],
  );
  const total = Number(rows[0]?.total ?? 0);
  sendJson(res, 200, {
    total,
    clusters: rows.map((c) => ({ id: c.id, title: c.title, status: c.status, itemCount: Number(c.n) })),
  });
}

async function clusterCreate(_app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const slug = wsSlug(url.pathname);
  const member = await requireMember(ctx, slug);
  requireSeat(member);
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const title = typeof body.title === 'string' ? body.title : '';
  if (codePoints(title) < 1 || codePoints(title) > 80 || title.trim().length === 0) {
    errors.title = 'Enter a title of 1 to 80 characters.';
  }
  const publicDescription = typeof body.publicDescription === 'string' ? body.publicDescription : '';
  const internalNote = typeof body.internalNote === 'string' ? body.internalNote : '';
  if (codePoints(publicDescription) > 2000) errors.publicDescription = 'Use at most 2000 characters.';
  if (codePoints(internalNote) > 2000) errors.internalNote = 'Use at most 2000 characters.';
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const id = newId();
  await ctx.db.query(
    `insert into clusters (id, workspace_id, title, public_description, internal_note, status, owner_id, version)
     values ($1,$2,$3,$4,$5,'draft',$6,1)`,
    [id, member.workspace.id, title, publicDescription, internalNote, member.account.id],
  );
  const row = (await one<ClusterRow>(ctx.db, `select * from clusters where id = $1`, [id]))!;
  sendJson(res, 201, await clusterFull(ctx, row, slug, member.workspace.time_zone));
}

export async function clusterFull(ctx: Ctx, row: ClusterRow, slug: string, timeZone: string): Promise<unknown> {
  const entries = await many<{ id: string; position: number; is_private: boolean; reference_id: string; added_by: string }>(
    ctx.db,
    `select id, position, is_private, reference_id, added_by from entries where cluster_id = $1 order by position`,
    [row.id],
  );
  const refIds = entries.map((e) => e.reference_id);
  const refs = new Map<string, ReferenceRow>();
  const people = new Map<string, { display_name: string; handle: string }>();
  if (refIds.length > 0) {
    const refRows = await many<ReferenceRow>(ctx.db, `select * from reference_items where id = any($1::uuid[])`, [refIds]);
    for (const r of refRows) refs.set(r.id, r);
    const peopleRows = await many<{ id: string; display_name: string; handle: string }>(
      ctx.db,
      `select id, display_name, handle from accounts where id = any($1::uuid[])`,
      [[...new Set(entries.map((e) => e.added_by))]],
    );
    for (const p of peopleRows) people.set(p.id, p);
  }
  const owner = (await one<PersonRow>(ctx.db, `select display_name, handle from accounts where id = $1`, [row.owner_id]))!;
  const ownerRow = { display_name: owner.display_name, handle: owner.handle };
  const eff = row.status;
  return {
    id: row.id,
    workspace: slug,
    title: row.title,
    publicDescription: row.public_description,
    internalNote: row.internal_note,
    status: eff,
    owner: { displayName: owner.display_name, handle: owner.handle },
    itemCount: entries.length,
    version: row.version,
    timeZone,
    liftLocal: row.lifts_local,
    liftsAt: row.lifts_at ? row.lifts_at.toISOString() : null,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    entries: entries.map((e) => {
      const ref = refs.get(e.reference_id)!;
      const creator = people.get(ref.created_by) ?? ownerRow;
      return {
        id: e.id,
        position: e.position,
        isPrivate: e.is_private,
        reference: referenceView(ref, { displayName: creator.display_name, handle: creator.handle }, slug),
      };
    }),
  };
}
