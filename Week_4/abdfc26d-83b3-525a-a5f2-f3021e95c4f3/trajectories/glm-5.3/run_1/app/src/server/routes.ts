import { createHmac, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppError, sendJson } from '../errors.js';
import { EMAIL_RE, VAT_RATES, editionSeedHash, isEasing, refundAllocation, renderCost, vatOf } from '../domain.js';
import type { Keyframe, Timeline, Uniform } from '../types.js';
import { transaction, query, type Tx } from './db.js';
import * as credits from './credits.js';
import { idemBegin, idemFinish, idemLookup } from './idempotency.js';
import { queueMail } from './outbox.js';
import { orderBody, pieceAssets, editionsLeft, editionStatuses, expireHolds, getPiece, getOrder, moveOrder, saleSplitRows, type PieceRow } from './store.js';
import { nextCreditNoteNumber } from './sequences.js';
import { refundNoticeEmail, statementEmail, creditNoteHtml, statementHtml } from './documents.js';
import { renderPdf } from './lib/gotenberg.js';
import { cancelRender } from './renders.js';
import type { Ctx } from './router.js';
import { idem, pathParam } from './router.js';
import type { AppServices, ServiceChecks } from './services.js';
import { applySubscriptionInvoice, confirmOrderPayment, killbillChargeDescription, paymentSucceeded } from './billing.js';

export interface RouteDeps {
  services: AppServices;
  checks: ServiceChecks;
}

const FORBIDDEN_DRAFT = AppError.notFound();

function requireCreator(ctx: Ctx): void {
  if (!ctx.user) throw AppError.unauthenticated();
  if (!ctx.user.roles.includes('creator')) throw AppError.forbidden();
}

function requireFounder(ctx: Ctx): void {
  if (!ctx.user) throw AppError.unauthenticated();
  if (!ctx.user.roles.includes('founder-operator')) throw AppError.forbidden();
}

function requireAny(ctx: Ctx): NonNullable<Ctx['user']> {
  if (!ctx.user) throw AppError.unauthenticated();
  return ctx.user;
}

async function visiblePiece(ctx: Ctx, slug: string): Promise<PieceRow> {
  const piece = await getPiece(slug);
  if (!piece) throw AppError.notFound();
  const isOwner = ctx.user?.id === piece.creator_id;
  const isFounder = ctx.user?.roles.includes('founder-operator') ?? false;
  if (piece.state === 'published') return piece;
  if ((piece.state === 'draft' || piece.state === 'withdrawn') && (isOwner || isFounder)) return piece;
  throw FORBIDDEN_DRAFT;
}

// ---------------------------------------------------------------- gallery

export async function gallery(ctx: Ctx): Promise<void> {
  const creator = ctx.url.searchParams.get('creator');
  const params: unknown[] = [];
  let filter = '';
  if (creator) {
    params.push(creator);
    filter = `AND u.username = $${params.length}`;
  }
  const rows = await query<{ slug: string }>(
    `SELECT p.slug FROM pieces p JOIN users u ON u.id = p.creator_id WHERE p.state = 'published' ${filter} ORDER BY p.published_at DESC, p.slug`,
    params as never[]
  );
  const cards = await Promise.all(rows.map(async (row) => {
    const piece = await getPiece(row.slug);
    if (!piece) return null;
    const left = await editionsLeft(row.slug);
    return {
      slug: piece.slug,
      title: piece.title,
      creator_display_name: piece.creator_name,
      engine: 'GLSL' as const,
      edition_count: piece.edition_count ?? 0,
      editions_left: left ?? 0,
      price_cents: piece.price_cents ?? 0,
      remix_of: piece.remix_of_slug ? { slug: piece.remix_of_slug, title: piece.remix_of_title ?? '', creator_display_name: piece.remix_of_creator ?? '' } : null,
      published_at: piece.published_at?.toISOString() ?? null
    };
  }));
  const all = cards.filter((c): c is NonNullable<typeof c> => c !== null);
  const featuredRow = creator
    ? all.find((c) => c.slug === 'tidewater-bloom') ?? all[0] ?? null
    : all.find((c) => c.slug === 'tidewater-bloom') ?? all[0] ?? null;
  const runs = all.filter((c) => c.remix_of === null);
  const remixes = all.filter((c) => c.remix_of !== null);
  sendJson(ctx.res, 200, {
    featured: featuredRow,
    sections: [
      { id: 'runs', title: 'Fresh runs', total: runs.length, pieces: runs },
      { id: 'remixes', title: 'Remixes', total: remixes.length, pieces: remixes }
    ]
  });
}

export async function pieceDetail(ctx: Ctx): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const piece = await visiblePiece(ctx, slug);
  const owner = ctx.user?.id === piece.creator_id;
  const left = piece.state === 'published' ? await editionsLeft(slug) : null;
  const body = {
    slug: piece.slug,
    title: piece.title,
    state: piece.state,
    version: piece.version,
    engine: 'GLSL' as const,
    creator: { id: owner ? piece.creator_id : '', display_name: piece.creator_name },
    ...(owner ? { fragment_source: piece.fragment_source } : {}),
    uniforms: piece.uniforms,
    timeline: piece.timeline,
    ...(owner ? { assets: await pieceAssets(slug) } : {}),
    remix_of: piece.remix_of_slug ? { slug: piece.remix_of_slug, title: piece.remix_of_title ?? '', creator_display_name: piece.remix_of_creator ?? '' } : null,
    edition_count: piece.edition_count,
    price_cents: piece.price_cents,
    editions_left: left,
    export_render_id: owner ? piece.export_render_id : null
  };
  sendJson(ctx.res, 200, body, { ETag: `"${piece.version}"` });
}

export async function pieceEditions(ctx: Ctx): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const piece = await getPiece(slug);
  if (!piece || piece.state !== 'published') throw AppError.notFound();
  const { edition_count, editions } = await editionStatuses(slug, ctx.user?.id ?? null);
  sendJson(ctx.res, 200, {
    edition_count,
    editions: editions.map((e) => ({ ...e, seed_hash: editionSeedHash(slug, e.number) }))
  });
}

// ---------------------------------------------------------------- describe + save

interface DescribeBody { prompt?: unknown }

export async function describePiece(ctx: Ctx, deps: RouteDeps): Promise<void> {
  requireCreator(ctx);
  const body = ctx.body<DescribeBody>();
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (prompt.trim().length < 3 || prompt.length > 500) {
    throw AppError.validation({ prompt: 'Describe the piece in 3 to 500 characters.' });
  }
  const outcome = await deps.services.ai.describe(prompt);
  if (!outcome.ok) {
    throw outcome.reason === 'unavailable'
      ? new AppError(503, 'provider_unavailable', 'The shader assistant is offline. Your prompt is kept; try again in a minute.')
      : new AppError(502, 'provider_malformed', 'The shader assistant sent something we can\'t run. Try a different prompt.');
  }
  const graph = outcome.graph;
  const slugBase = graph.title_suggestion.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  const slug = `${slugBase}-${randomUUID().slice(0, 4)}`;
  const uniforms: Uniform[] = graph.uniforms.map((u) => ({ name: u.name, label: u.label, min: u.min, max: u.max, value: u.default }));
  await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO pieces (slug, title, state, version, engine, creator_id, fragment_source, uniforms, timeline)
       VALUES ($1,$2,'draft',1,'GLSL',$3,$4,$5::jsonb,$6::jsonb)`,
      [slug, graph.title_suggestion, ctx.user!.id, graph.fragment_source, JSON.stringify(uniforms),
       JSON.stringify({ duration_s: 10, tracks: [], audio_asset_id: null })]
    );
  });
  const piece = await getPiece(slug);
  const left = null;
  const bodyOut = {
    piece: {
      slug: piece!.slug, title: piece!.title, state: piece!.state, version: piece!.version, engine: 'GLSL',
      creator: { id: piece!.creator_id, display_name: piece!.creator_name },
      fragment_source: piece!.fragment_source, uniforms: piece!.uniforms, timeline: piece!.timeline,
      assets: [], remix_of: null, edition_count: null, price_cents: null, editions_left: left, export_render_id: null
    }
  };
  sendJson(ctx.res, 201, bodyOut);
}

interface SaveBody {
  title?: unknown;
  uniforms?: Record<string, unknown>;
  timeline?: unknown;
}

function parseTimeline(raw: unknown, fallbackDuration: number): Timeline {
  if (raw === null || raw === undefined) return { duration_s: fallbackDuration, tracks: [], audio_asset_id: null };
  if (typeof raw !== 'object') throw AppError.validation({ timeline: 'Send a timeline.' });
  const obj = raw as Record<string, unknown>;
  const duration = typeof obj.duration_s === 'number' && obj.duration_s > 0 && obj.duration_s <= 600 ? obj.duration_s : fallbackDuration;
  const tracks: Timeline['tracks'] = [];
  if (Array.isArray(obj.tracks)) {
    for (const trackRaw of obj.tracks) {
      const track = trackRaw as Record<string, unknown>;
      if (typeof track.uniform !== 'string') throw AppError.validation({ timeline: 'Each track needs a uniform.' });
      const keyframes: Keyframe[] = [];
      for (const kfRaw of Array.isArray(track.keyframes) ? track.keyframes : []) {
        const kf = kfRaw as Record<string, unknown>;
        if (typeof kf.time_s !== 'number' || typeof kf.value !== 'number' || !isEasing(kf.easing)) {
          throw AppError.validation({ timeline: 'Keyframes need time_s, value and a known easing.' });
        }
        keyframes.push({ time_s: kf.time_s, value: kf.value, easing: kf.easing });
      }
      tracks.push({ uniform: track.uniform, keyframes });
    }
  }
  const audio = typeof obj.audio_asset_id === 'string' ? obj.audio_asset_id : null;
  return { duration_s: duration, tracks, audio_asset_id: audio };
}

export async function savePiece(ctx: Ctx): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const user = requireAny(ctx);
  const piece = await getPiece(slug);
  if (!piece || piece.creator_id !== user.id) throw AppError.notFound();
  if (piece.state !== 'draft') throw AppError.invalidTransition();
  const match = /"(\d+)"/.exec(ctx.req.headers['if-match'] ?? '');
  if (!match) throw AppError.versionRequired();
  const clientVersion = Number(match[1]);
  if (clientVersion !== piece.version) {
    throw new AppError(412, 'version_conflict', 'This piece changed in another tab. Reload to see the current version.', { extra: { current_version: piece.version } });
  }
  const body = ctx.body<SaveBody>();
  const title = typeof body.title === 'string' && body.title.trim().length > 0 && body.title.length <= 200 ? body.title : piece.title;
  const uniformsIn = body.uniforms ?? {};
  const uniforms: Uniform[] = piece.uniforms.map((u) => {
    const raw = uniformsIn[u.name];
    const value = typeof raw === 'number' ? Math.min(u.max, Math.max(u.min, raw)) : u.value;
    return { ...u, value };
  });
  const timeline = parseTimeline(body.timeline, piece.timeline.duration_s);
  const newVersion = piece.version + 1;
  await transaction(async (tx) => {
    const updated = await tx.query<{ slug: string }>(
      `UPDATE pieces SET title = $2, uniforms = $3::jsonb, timeline = $4::jsonb, version = version + 1
       WHERE slug = $1 AND version = $5 RETURNING slug`,
      [slug, title, JSON.stringify(uniforms), JSON.stringify(timeline), piece.version]
    );
    if (updated.length === 0) {
      throw new AppError(412, 'version_conflict', 'This piece changed in another tab. Reload to see the current version.', { extra: { current_version: piece.version + 1 } });
    }
  });
  const fresh = await getPiece(slug);
  sendJson(ctx.res, 200, {
    slug: fresh!.slug, title: fresh!.title, state: fresh!.state, version: newVersion, engine: 'GLSL',
    creator: { id: fresh!.creator_id, display_name: fresh!.creator_name },
    fragment_source: fresh!.fragment_source, uniforms: fresh!.uniforms, timeline: fresh!.timeline,
    assets: await pieceAssets(slug), remix_of: fresh!.remix_of_slug ? { slug: fresh!.remix_of_slug, title: fresh!.remix_of_title, creator_display_name: fresh!.remix_of_creator } : null,
    edition_count: fresh!.edition_count, price_cents: fresh!.price_cents, editions_left: null, export_render_id: fresh!.export_render_id
  });
}

// ---------------------------------------------------------------- assets, renders, publish

const ASSET_KINDS: Record<string, string[]> = {
  font: ['.woff2', '.ttf'],
  model: ['.glb'],
  audio: ['.wav', '.mp3']
};

export async function uploadAsset(ctx: Ctx, deps: RouteDeps): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const user = requireAny(ctx);
  const piece = await getPiece(slug);
  if (!piece || piece.creator_id !== user.id) throw AppError.notFound();
  if (piece.state !== 'draft') throw AppError.invalidTransition();
  const multipart = (ctx.req as unknown as { __multipart?: { fields: Record<string, string>; file?: { filename: string; bytes: Buffer } } }).__multipart;
  const file = multipart?.file;
  if (!file) throw AppError.validation({ file: 'Attach a file.' });
  const kind = multipart.fields.kind ?? '';
  const allowed = ASSET_KINDS[kind];
  if (!allowed) throw AppError.validation({ kind: 'Kind must be font, model or audio.' });
  const lower = file.filename.toLowerCase();
  if (!allowed.some((ext) => lower.endsWith(ext))) {
    throw AppError.validation({ file: `Files of kind ${kind} must end in ${allowed.join(' or ')}.` });
  }
  const id = randomUUID();
  const key = `pieces/${slug}/assets/${id}/${file.filename}`;
  await deps.services.storage.put(key, file.bytes, 'application/octet-stream');
  await transaction(async (tx) => {
    await tx.query(`INSERT INTO assets (id, piece_slug, kind, filename, bytes) VALUES ($1,$2,$3,$4,$5)`,
      [id, slug, kind, file.filename, file.bytes.length]);
  });
  sendJson(ctx.res, 201, { asset: { id, kind: kind as 'font' | 'model' | 'audio', filename: file.filename, bytes: file.bytes.length } });
}

interface RenderBody {
  format?: unknown; resolution?: unknown; duration_s?: unknown; aspect?: unknown;
}

const RESOLUTIONS = ['720p', '1080p'];
const FORMATS = ['mp4', 'webm'];
const ASPECTS = ['16:9', '9:16', '1:1', '4:5'];

export async function createRender(ctx: Ctx, deps: RouteDeps): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const key = idem(ctx);
  const user = requireAny(ctx);
  const piece = await getPiece(slug);
  if (!piece || piece.creator_id !== user.id) throw AppError.notFound();
  if (piece.state !== 'draft') throw AppError.invalidTransition();
  const body = ctx.body<RenderBody>();
  const format = typeof body.format === 'string' && FORMATS.includes(body.format) ? body.format as 'mp4' | 'webm' : null;
  const resolution = typeof body.resolution === 'string' && RESOLUTIONS.includes(body.resolution) ? body.resolution as '720p' | '1080p' : null;
  const aspect = typeof body.aspect === 'string' && ASPECTS.includes(body.aspect) ? body.aspect as '16:9' | '9:16' | '1:1' | '4:5' : null;
  const duration = typeof body.duration_s === 'number' ? body.duration_s : null;
  const fields: Record<string, string> = {};
  if (!format) fields.format = 'Pick MP4 or WebM.';
  if (!resolution) fields.resolution = 'Pick 720p or 1080p.';
  if (!aspect) fields.aspect = 'Pick 16:9, 9:16, 1:1 or 4:5.';
  if (duration === null || duration < 5 || duration > 60) fields.duration_s = 'Duration is 5 to 60 seconds.';
  if (Object.keys(fields).length > 0) throw AppError.validation(fields);

  const rawBody = (ctx.req as unknown as { __bodyText?: string }).__bodyText ?? '';
  const result = await transaction(async (tx) => {
    const stored = await idemLookup(tx, user.id, 'POST', `/api/pieces/${slug}/renders`, key, rawBody);
    if (stored && !stored.inProgress) return { replay: stored.replay, render: null as null };
    if (stored?.inProgress) throw new AppError(409, 'idempotency_in_progress', 'That request is still running.');
    await idemBegin(tx, user.id, 'POST', `/api/pieces/${slug}/renders`, key, rawBody);
    const cost = renderCost(resolution!, Math.round(duration!));
    const id = `rn_${randomUUID()}`;
    try {
      await credits.reserve(tx, user.id, cost, id);
      await tx.query(
        `INSERT INTO renders (id, piece_slug, state, cost_credits, attempts, format, resolution, duration_s, aspect, history)
         VALUES ($1,$2,'accepted',$3,0,$4,$5,$6,$7,$8::jsonb)`,
        [id, slug, cost, format, resolution, Math.round(duration!), aspect,
         JSON.stringify([{ state: 'accepted', at: new Date().toISOString() }])]
      );
      await tx.query(`UPDATE renders SET state = 'queued', history = history || $2::jsonb WHERE id = $1`,
        [id, JSON.stringify([{ state: 'queued', at: new Date().toISOString() }])]);
      return { replay: null, render: { id, cost } };
    } catch (err) {
      await idemBegin(tx, user.id, 'POST', `/api/pieces/${slug}/renders`, key, rawBody);
      throw err;
    }
  });
  if (result.replay) {
    sendJson(ctx.res, result.replay.status, result.replay.body, { 'Idempotent-Replayed': 'true' });
    return;
  }
  await deps.services.queue.publish({ render_id: result.render!.id, piece_slug: slug, attempt: 1 }).catch(() => null);
  const row = await transaction(async (tx) => tx.one<Record<string, unknown>>(
    `SELECT id, piece_slug, state, failure_reason, cost_credits, attempts, format, resolution, duration_s, aspect, sha256, history::text AS history_json, created_at FROM renders WHERE id = $1`,
    [result.render!.id]
  ));
  const render = renderRowOut(row!);
  await transaction(async (tx) => {
    await idemFinish(tx, user.id, 'POST', `/api/pieces/${slug}/renders`, key, 202, { render });
  });
  sendJson(ctx.res, 202, { render });
}

function renderRowOut(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    piece_slug: row.piece_slug,
    state: row.state,
    failure_reason: row.failure_reason ?? null,
    cost_credits: row.cost_credits,
    attempts: row.attempts,
    format: row.format,
    resolution: row.resolution,
    duration_s: row.duration_s,
    aspect: row.aspect,
    sha256: row.sha256 ?? null,
    history: JSON.parse(row.history_json as string),
    created_at: new Date(row.created_at as string).toISOString()
  };
}

export async function listRenders(ctx: Ctx): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const user = requireAny(ctx);
  const piece = await getPiece(slug);
  if (!piece || piece.creator_id !== user.id) throw AppError.notFound();
  const rows = await query<Record<string, unknown>>(
    `SELECT id, piece_slug, state, failure_reason, cost_credits, attempts, format, resolution, duration_s, aspect, sha256, history::text AS history_json, created_at
     FROM renders WHERE piece_slug = $1 ORDER BY created_at DESC`,
    [slug]
  );
  sendJson(ctx.res, 200, { renders: rows.map((row) => renderRowOut(row)) });
}

export async function getRenderById(ctx: Ctx): Promise<void> {
  const id = pathParam(ctx, 'id');
  const user = requireAny(ctx);
  const row = await transaction(async (tx) => tx.one<Record<string, unknown>>(
    `SELECT r.id, r.piece_slug, r.state, r.failure_reason, r.cost_credits, r.attempts, r.format, r.resolution, r.duration_s, r.aspect, r.sha256, r.history::text AS history_json, r.created_at
     FROM renders r JOIN pieces p ON p.slug = r.piece_slug WHERE r.id = $1`,
    [id]
  ));
  if (!row) throw AppError.notFound();
  const piece = await getPiece(row.piece_slug as string);
  const isOwner = piece?.creator_id === user.id;
  const isFounder = user.roles.includes('founder-operator');
  if (!isOwner && !isFounder) throw AppError.notFound();
  sendJson(ctx.res, 200, renderRowOut(row));
}

export async function cancelRenderRoute(ctx: Ctx): Promise<void> {
  const id = pathParam(ctx, 'id');
  const user = requireAny(ctx);
  const row = await query<Record<string, unknown>>(`SELECT piece_slug FROM renders WHERE id = $1`, [id]);
  if (row.length === 0) throw AppError.notFound();
  const piece = await getPiece(row[0].piece_slug as string);
  if (!piece || piece.creator_id !== user.id) throw AppError.notFound();
  const render = await cancelRender(id);
  if (!render) throw AppError.invalidTransition();
  sendJson(ctx.res, 200, renderRowOut({
    id: render.id, piece_slug: render.piece_slug, state: render.state, failure_reason: render.failure_reason,
    cost_credits: render.cost_credits, attempts: render.attempts, format: render.format, resolution: render.resolution,
    duration_s: render.duration_s, aspect: render.aspect, sha256: render.sha256,
    history_json: JSON.stringify(render.history), created_at: render.created_at
  }));
}

// ---------------------------------------------------------------- publish, withdraw, remix

interface PublishBody { edition_count?: unknown; price_cents?: unknown; export_render_id?: unknown }

export async function publishPiece(ctx: Ctx): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const user = requireAny(ctx);
  const piece = await getPiece(slug);
  if (!piece || piece.creator_id !== user.id) throw AppError.notFound();
  if (piece.state !== 'draft') throw AppError.invalidTransition();
  const body = ctx.body<PublishBody>();
  const fields: Record<string, string> = {};
  const editionCount = typeof body.edition_count === 'number' ? body.edition_count : null;
  const priceCents = typeof body.price_cents === 'number' ? body.price_cents : null;
  const exportRenderId = typeof body.export_render_id === 'string' ? body.export_render_id : null;
  if (editionCount === null || editionCount < 1 || editionCount > 500 || !Number.isInteger(editionCount)) fields.edition_count = 'Editions are 1 to 500.';
  if (priceCents === null || priceCents < 100 || priceCents > 500000 || !Number.isInteger(priceCents)) fields.price_cents = 'Price is $1.00 to $5,000.00.';
  if (!exportRenderId) fields.export_render_id = 'Pick a ready export.';
  if (Object.keys(fields).length > 0) throw AppError.validation(fields);
  const render = await query<Record<string, unknown>>(`SELECT piece_slug, state FROM renders WHERE id = $1`, [exportRenderId!]);
  if (render.length === 0 || render[0].piece_slug !== slug || render[0].state !== 'ready') {
    throw AppError.validation({ export_render_id: 'Pick a ready export of this piece.' });
  }
  await transaction(async (tx) => {
    await tx.query(
      `UPDATE pieces SET state = 'published', edition_count = $2, price_cents = $3, export_render_id = $4, published_at = now()
       WHERE slug = $1 AND state = 'draft'`,
      [slug, editionCount, priceCents, exportRenderId]
    );
  });
  const fresh = await getPiece(slug);
  sendJson(ctx.res, 200, {
    slug: fresh!.slug, title: fresh!.title, state: fresh!.state, version: fresh!.version, engine: 'GLSL',
    creator: { id: fresh!.creator_id, display_name: fresh!.creator_name },
    fragment_source: fresh!.fragment_source, uniforms: fresh!.uniforms, timeline: fresh!.timeline,
    assets: await pieceAssets(slug),
    remix_of: fresh!.remix_of_slug ? { slug: fresh!.remix_of_slug, title: fresh!.remix_of_title, creator_display_name: fresh!.remix_of_creator } : null,
    edition_count: fresh!.edition_count, price_cents: fresh!.price_cents, editions_left: await editionsLeft(slug), export_render_id: exportRenderId
  });
}

export async function withdrawPiece(ctx: Ctx): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const user = requireAny(ctx);
  const piece = await getPiece(slug);
  if (!piece || piece.creator_id !== user.id) throw AppError.notFound();
  if (piece.state !== 'published') throw AppError.invalidTransition();
  await transaction(async (tx) => {
    await tx.query(`UPDATE orders SET state = 'expired' WHERE piece_slug = $1 AND state = 'held'`, [slug]);
    await tx.query(`UPDATE pieces SET state = 'withdrawn', featured = false WHERE slug = $1 AND state = 'published'`, [slug]);
  });
  const fresh = await getPiece(slug);
  sendJson(ctx.res, 200, {
    slug: fresh!.slug, title: fresh!.title, state: fresh!.state, version: fresh!.version, engine: 'GLSL',
    creator: { id: fresh!.creator_id, display_name: fresh!.creator_name },
    fragment_source: fresh!.fragment_source, uniforms: fresh!.uniforms, timeline: fresh!.timeline,
    assets: await pieceAssets(slug),
    remix_of: fresh!.remix_of_slug ? { slug: fresh!.remix_of_slug, title: fresh!.remix_of_title, creator_display_name: fresh!.remix_of_creator } : null,
    edition_count: fresh!.edition_count, price_cents: fresh!.price_cents, editions_left: null, export_render_id: fresh!.export_render_id
  });
}

export async function remixPiece(ctx: Ctx): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const user = requireAny(ctx);
  requireCreator(ctx);
  const source = await getPiece(slug);
  if (!source || source.state !== 'published') throw AppError.notFound();
  if (source.creator_id === user.id) throw new AppError(409, 'own_piece', 'You cannot remix your own piece.');
  if (source.remix_of_slug !== null) throw new AppError(409, 'remix_of_remix', 'A remix cannot be remixed.');
  const title = `${source.title} (remix)`;
  const slugBase = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const newSlug = `${slugBase}-${randomUUID().slice(0, 4)}`;
  await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO pieces (slug, title, state, version, engine, creator_id, fragment_source, uniforms, timeline, remix_of_slug)
       VALUES ($1,$2,'draft',1,'GLSL',$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [newSlug, title, user.id, source.fragment_source, JSON.stringify(source.uniforms), JSON.stringify(source.timeline), slug]
    );
  });
  const fresh = await getPiece(newSlug);
  sendJson(ctx.res, 201, {
    piece: {
      slug: fresh!.slug, title: fresh!.title, state: fresh!.state, version: fresh!.version, engine: 'GLSL',
      creator: { id: fresh!.creator_id, display_name: fresh!.creator_name },
      fragment_source: fresh!.fragment_source, uniforms: fresh!.uniforms, timeline: fresh!.timeline,
      assets: [], remix_of: { slug, title: source.title, creator_display_name: source.creator_name },
      edition_count: null, price_cents: null, editions_left: null, export_render_id: null
    }
  });
}

// ---------------------------------------------------------------- holds and checkout

export async function createHold(ctx: Ctx, deps: RouteDeps): Promise<void> {
  const slug = pathParam(ctx, 'slug');
  const n = Number(pathParam(ctx, 'n'));
  const key = idem(ctx);
  const user = requireAny(ctx);
  const piece = await getPiece(slug);
  if (!piece || piece.state !== 'published' || piece.edition_count === null) throw AppError.notFound();
  if (!Number.isInteger(n) || n < 1 || n > piece.edition_count) throw AppError.notFound();
  if (piece.creator_id === user.id) throw new AppError(409, 'own_piece', 'You cannot buy your own piece.');
  const rawBody = (ctx.req as unknown as { __bodyText?: string }).__bodyText ?? '';
  const id = `ord_${randomUUID()}`;
  const result = await transaction(async (tx) => {
    const stored = await idemLookup(tx, user.id, 'POST', `/api/pieces/${slug}/editions/${n}/holds`, key, rawBody);
    if (stored && !stored.inProgress) return { replay: stored.replay, order: null as null };
    if (stored?.inProgress) throw new AppError(409, 'idempotency_in_progress', 'That request is still running.');
    await idemBegin(tx, user.id, 'POST', `/api/pieces/${slug}/editions/${n}/holds`, key, rawBody);

    const mine = await tx.one<{ id: string; state: string }>(
      `SELECT id, state FROM orders WHERE piece_slug = $1 AND collector_id = $2 AND state = 'held' FOR UPDATE`,
      [slug, user.id]
    );
    if (mine) {
      const sameNumber = await tx.one<{ id: string; edition: number }>(
        `SELECT id, edition FROM orders WHERE id = $1 AND edition = $2 AND state = 'held'`,
        [mine.id, n]
      );
      if (sameNumber) return { replay: null, order: sameNumber.id, existing: true };
      await tx.query(`UPDATE orders SET state = 'expired' WHERE id = $1 AND state = 'held'`, [mine.id]);
    }
    const taken = await tx.one<{ id: string }>(
      `SELECT id FROM orders WHERE piece_slug = $1 AND edition = $2 AND state IN ('held','paying') FOR UPDATE`,
      [slug, n]
    );
    if (taken) return { replay: null, order: null, nextFree: await nearestFree(tx, slug, n, piece.edition_count!) };
    const now = new Date();
    const expires = new Date(now.getTime() + config.holdSeconds * 1000);
    await tx.query(
      `INSERT INTO orders (id, piece_slug, collector_id, edition, state, expires_at, net_cents, vat_rate_percent, vat_cents, gross_cents)
       VALUES ($1,$2,$3,$4,'held',$5,$6,$7,$8,$9)`,
      [id, slug, user.id, n, expires, piece.price_cents, 0, 0, piece.price_cents]
    );
    return { replay: null, order: id, existing: false };
  });
  if (result.replay) {
    sendJson(ctx.res, result.replay.status, result.replay.body, { 'Idempotent-Replayed': 'true' });
    return;
  }
  if (result.order === null) {
    const err = new AppError(409, 'edition_taken', 'That edition was just taken.', { extra: { next_free: result.nextFree } });
    await transaction(async (tx) => {
      await idemFinish(tx, user.id, 'POST', `/api/pieces/${slug}/editions/${n}/holds`, key, err.status, errorBody(err));
    });
    throw err;
  }
  const order = await getOrder(result.order);
  const body = orderBody(order!);
  await transaction(async (tx) => {
    await idemFinish(tx, user.id, 'POST', `/api/pieces/${slug}/editions/${n}/holds`, key, result.existing ? 200 : 201, body);
  });
  sendJson(ctx.res, result.existing ? 200 : 201, body);
  void deps;
}

function errorBody(err: AppError): unknown {
  const out: Record<string, unknown> = { error: { code: err.code, message: err.message } };
  if (err.extra) for (const [k, v] of Object.entries(err.extra)) (out.error as Record<string, unknown>)[k] = v;
  return out;
}

async function nearestFree(tx: Tx, slug: string, requested: number, editionCount: number): Promise<number | null> {
  const takenRows = await tx.query<{ edition: number }>(
    `SELECT edition FROM orders WHERE piece_slug = $1 AND state IN ('held','paying','paid','invoiced','receipted')`,
    [slug]
  );
  const taken = new Set(takenRows.map((r) => r.edition));
  const free: number[] = [];
  for (let i = 1; i <= editionCount; i++) if (!taken.has(i)) free.push(i);
  if (free.length === 0) return null;
  let best = free[0];
  let bestDist = Math.abs(free[0] - requested);
  for (const candidate of free) {
    const dist = Math.abs(candidate - requested);
    if (dist < bestDist || (dist === bestDist && candidate < best)) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

export async function currentOrder(ctx: Ctx): Promise<void> {
  const slug = ctx.url.searchParams.get('piece') ?? '';
  const user = requireAny(ctx);
  await expireHolds();
  const rows = await query<{ id: string }>(
    `SELECT id FROM orders WHERE piece_slug = $1 AND collector_id = $2 AND state IN ('held','paying') ORDER BY created_at DESC LIMIT 1`,
    [slug, user.id]
  );
  if (rows.length === 0) throw AppError.notFound();
  const order = await getOrder(rows[0].id);
  sendJson(ctx.res, 200, orderBody(order!));
}

export async function releaseHold(ctx: Ctx): Promise<void> {
  const id = pathParam(ctx, 'id');
  const user = requireAny(ctx);
  const order = await getOrder(id);
  if (!order || (order.collector_id !== user.id && !user.roles.includes('founder-operator'))) throw AppError.notFound();
  if (order.state !== 'held') throw AppError.invalidTransition();
  await transaction(async (tx) => {
    await moveOrder(tx, id, 'held', 'expired');
  });
  const fresh = await getOrder(id);
  sendJson(ctx.res, 200, orderBody(fresh!));
}

interface BuyBody { billing_name?: unknown; email?: unknown; billing_country?: unknown }

export async function buyOrder(ctx: Ctx, deps: RouteDeps): Promise<void> {
  const id = pathParam(ctx, 'id');
  const key = idem(ctx);
  const user = requireAny(ctx);
  const order = await getOrder(id);
  if (!order || order.collector_id !== user.id) throw AppError.notFound();
  const body = ctx.body<BuyBody>();
  const billingName = typeof body.billing_name === 'string' ? body.billing_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const country = typeof body.billing_country === 'string' ? body.billing_country : '';
  const fields: Record<string, string> = {};
  if (billingName.length < 1 || billingName.length > 120) fields.billing_name = 'Enter the name for the invoice.';
  if (!EMAIL_RE.test(email)) fields.email = 'Enter an email address.';
  if (!(country in VAT_RATES)) fields.billing_country = "We can't invoice that country yet.";
  if (Object.keys(fields).length > 0) throw AppError.validation(fields);

  const vat = vatOf(order.net_cents, VAT_RATES[country]);
  const gross = order.net_cents + vat;
  const killbillProbe = deps.checks.latest.get('killbill');
  if (killbillProbe && !killbillProbe.reachable) throw AppError.paymentsUnavailable();

  const rawBody = (ctx.req as unknown as { __bodyText?: string }).__bodyText ?? '';
  const result = await transaction(async (tx) => {
    // A stored replay answers before any state check, per the precedence order.
    const stored = await idemLookup(tx, user.id, 'POST', `/api/orders/${id}/buy`, key, rawBody);
    if (stored && !stored.inProgress) return { replay: stored.replay, order: null as null };
    if (stored?.inProgress) throw new AppError(409, 'idempotency_in_progress', 'That request is still running.');
    const fresh = await tx.one<{ state: string }>(`SELECT state FROM orders WHERE id = $1 FOR UPDATE`, [id]);
    if (!fresh) throw AppError.notFound();
    if (fresh.state === 'expired') throw new AppError(409, 'hold_expired', 'Your hold on this edition expired.');
    if (fresh.state !== 'held') throw AppError.invalidTransition();
    await idemBegin(tx, user.id, 'POST', `/api/orders/${id}/buy`, key, rawBody);
    return { replay: null, order: id };
  });
  if (result.replay) {
    sendJson(ctx.res, result.replay.status, result.replay.body, { 'Idempotent-Replayed': 'true' });
    return;
  }

  let kbInvoiceId: string | null = null;
  try {
    const account = await deps.services.killbill.ensureAccount(user.id, user.display_name, user.email);
    if (!account) throw AppError.paymentsUnavailable();
    const invoice = await deps.services.killbill.createChargeInvoice(
      account.accountId, gross, killbillChargeDescription(order.piece_title, order.edition, order.edition_count)
    );
    await deps.services.killbill.payInvoice(invoice.invoiceId, account.accountId, gross, `pay_${id}`);
    kbInvoiceId = invoice.invoiceId;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'killbill_unreachable') throw AppError.paymentsUnavailable();
    throw new Error(`killbill buy failed: ${message}`);
  }
  await transaction(async (tx) => {
    await tx.query(
      `UPDATE orders SET state = 'paying', billing_name = $2, email = $3, billing_country = $4, vat_rate_percent = $5, vat_cents = $6, gross_cents = $7, killbill_invoice_id = $8
       WHERE id = $1 AND state = 'held'`,
      [id, billingName, email, country, VAT_RATES[country], vat, gross, kbInvoiceId]
    );
  });
  const fresh = await getOrder(id);
  const bodyOut = orderBody(fresh!);
  await transaction(async (tx) => {
    await idemFinish(tx, user.id, 'POST', `/api/orders/${id}/buy`, key, 202, bodyOut);
  });
  sendJson(ctx.res, 202, bodyOut);
}

export async function getOrderById(ctx: Ctx): Promise<void> {
  const id = pathParam(ctx, 'id');
  const user = requireAny(ctx);
  const order = await getOrder(id);
  if (!order || (order.collector_id !== user.id && !user.roles.includes('founder-operator'))) throw AppError.notFound();
  await expireHolds();
  const fresh = await getOrder(id);
  sendJson(ctx.res, 200, orderBody(fresh!));
}

export async function myOrders(ctx: Ctx): Promise<void> {
  const user = requireAny(ctx);
  await expireHolds();
  const rows = await query<{ id: string }>(
    `SELECT id FROM orders WHERE collector_id = $1 AND state <> 'expired' ORDER BY created_at DESC`,
    [user.id]
  );
  const orders = await Promise.all(rows.map(async (row) => {
    const order = await getOrder(row.id);
    return order ? orderBody(order) : null;
  }));
  sendJson(ctx.res, 200, { orders: orders.filter((o) => o !== null) });
}

export async function orderDownload(ctx: Ctx, deps: RouteDeps, kind: 'export' | 'invoice'): Promise<void> {
  const id = pathParam(ctx, 'id');
  const user = requireAny(ctx);
  const order = await getOrder(id);
  if (!order || order.collector_id !== user.id) throw AppError.notFound();
  const paidStates = ['paid', 'invoiced', 'receipted', 'refunded'];
  if (!paidStates.includes(order.state)) throw AppError.invalidTransition();
  if (kind === 'export') {
    const piece = await getPiece(order.piece_slug);
    const key = piece?.export_render_id ? `renders/${piece.export_render_id}/export.mp4` : null;
    if (!key) throw AppError.invalidTransition();
    const exists = await deps.services.storage.exists(key).catch(() => null);
    if (exists !== true) throw AppError.storageUnavailable();
    const url = await deps.services.storage.presign(key, config.presignSeconds);
    sendJson(ctx.res, 200, { url, expires_in: config.presignSeconds });
    return;
  }
  if (order.invoice_status !== 'ready') {
    throw new AppError(409, 'invoice_pending', 'The invoice PDF is not ready yet.', { extra: { invoice_number: order.invoice_number } });
  }
  const year = (order.paid_at ?? new Date()).getUTCFullYear();
  const key = `invoices/${year}/${order.invoice_number}.pdf`;
  const exists = await deps.services.storage.exists(key).catch(() => null);
  if (exists !== true) throw AppError.storageUnavailable();
  const url = await deps.services.storage.presign(key, config.presignSeconds);
  sendJson(ctx.res, 200, { url, expires_in: config.presignSeconds });
}

// ---------------------------------------------------------------- billing callbacks

interface KbEvent {
  eventType?: unknown;
  objectType?: unknown;
  objectId?: unknown;
  accountId?: unknown;
  metaData?: Record<string, unknown>;
}

export async function killbillEvent(ctx: Ctx, deps: RouteDeps): Promise<void> {
  const token = ctx.url.searchParams.get('token') ?? '';
  const expected = callbackTokenFromConfig();
  if (token !== expected) throw AppError.unauthenticated();
  const event = ctx.body<KbEvent>();
  const eventType = typeof event.eventType === 'string' ? event.eventType : '';
  const invoiceId = typeof event.objectId === 'string' ? event.objectId : '';
  const paymentId = typeof event.metaData?.paymentId === 'string' ? (event.metaData.paymentId as string) : '';
  const identity = `${eventType}:${invoiceId}:${paymentId}`;
  const processed = await transaction(async (tx) => {
    const seen = await tx.one<{ identity: string }>(`SELECT identity FROM callback_events WHERE identity = $1 FOR UPDATE`, [identity]);
    if (seen) return false;
    await tx.query(`INSERT INTO callback_events (identity) VALUES ($1)`, [identity]);
    return true;
  });
  if (!processed) {
    sendJson(ctx.res, 204, {});
    return;
  }
  if (eventType === 'INVOICE_PAYMENT_SUCCESS' || eventType === 'INVOICE_PAYMENT_FAILED') {
    // Match an order by its Kill Bill invoice, or a plan by account and item.
    const orderRow = await query<{ id: string }>(`SELECT id FROM orders WHERE killbill_invoice_id = $1 AND state = 'paying'`, [invoiceId]);
    for (const row of orderRow) {
      await confirmOrderPayment({ killbill: deps.services.killbill, storage: deps.services.storage }, row.id).catch(() => null);
    }
    if (orderRow.length === 0) {
      const accountId = typeof event.accountId === 'string' ? event.accountId : '';
      if (accountId) {
        const plans = await query<{ user_id: string; code: string }>(
          `SELECT user_id, code FROM plans WHERE killbill_account_id = $1 AND state IN ('pending_payment','active','cancelling')`,
          [accountId]
        );
        for (const plan of plans) {
          const invoices = await deps.services.killbill.accountInvoices(accountId).catch(() => []);
          for (const invoice of invoices) {
            if (invoice.invoiceId !== invoiceId) continue;
            const payments = await deps.services.killbill.getInvoicePayments(invoiceId).catch(() => []);
            const paid = payments.some((p) => paymentSucceeded(p));
            if (!paid) continue;
            await transaction(async (tx) => {
              await applySubscriptionInvoice(tx, plan.user_id, plan.code, invoiceId);
            });
          }
        }
        const packs = await query<{ id: string; user_id: string }>(
          `SELECT id, user_id FROM credit_packs WHERE killbill_invoice_id = $1 AND state = 'paying'`,
          [invoiceId]
        );
        for (const pack of packs) {
          const payments = await deps.services.killbill.getInvoicePayments(invoiceId).catch(() => []);
          const paid = payments.some((p) => paymentSucceeded(p));
          if (paid) {
            await transaction(async (tx) => {
              const entry = await tx.one<{ id: string }>(`INSERT INTO credit_entries (kind, render_id) VALUES ('pack', NULL) RETURNING id::text`);
              if (!entry) return;
              await tx.query(`INSERT INTO credit_rows (entry_id, account, amount) VALUES ($1,'platform:issued',$2), ($1,$3,$4)`,
                [entry.id, -500, `creator:${pack.user_id}:available`, 500]);
              await tx.query(`UPDATE credit_packs SET state = 'paid' WHERE id = $1`, [pack.id]);
            });
          }
        }
      }
    }
  }
  sendJson(ctx.res, 204, {});
}

function callbackTokenFromConfig(): string {
  return createHmac('sha256', config.killbillApiSecret).update(config.killbillApiKey).digest('hex');
}

// ---------------------------------------------------------------- admin

export async function adminOrders(ctx: Ctx): Promise<void> {
  requireFounder(ctx);
  const state = ctx.url.searchParams.get('state');
  const rows = await query<{ id: string }>(
    state ? `SELECT id FROM orders WHERE state = $1 ORDER BY created_at DESC` : `SELECT id FROM orders ORDER BY created_at DESC`,
    state ? [state] : []
  );
  const orders = await Promise.all(rows.map(async (row) => {
    const order = await getOrder(row.id);
    return order ? orderBody(order) : null;
  }));
  sendJson(ctx.res, 200, { orders: orders.filter((o) => o !== null) });
}

export async function adminOrderSplits(ctx: Ctx): Promise<void> {
  requireFounder(ctx);
  const id = pathParam(ctx, 'id');
  const order = await getOrder(id);
  if (!order) throw AppError.notFound();
  const rows = await query<{ party: string; holder_id: string; kind: string; amount_cents: number; refund_id: string | null }>(
    `SELECT sr.party, sr.holder_id, sr.kind, sr.amount_cents, sr.refund_id
     FROM split_rows sr WHERE sr.order_id = $1 ORDER BY sr.id`,
    [id]
  );
  const nameRows = await query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users`);
  const names = new Map(nameRows.map((row) => [row.id, row.display_name]));
  sendJson(ctx.res, 200, {
    net_cents: order.net_cents,
    rows: rows.map((row) => ({
      party: row.party as 'creator' | 'remixer' | 'platform',
      holder: row.holder_id === 'platform' ? 'Brightmoss Works' : names.get(row.holder_id) ?? 'Creator',
      kind: row.kind as 'sale' | 'refund',
      amount_cents: row.amount_cents,
      refund_id: row.refund_id
    }))
  });
}

interface RefundBody { net_cents?: unknown; reason?: unknown }

export async function adminRefund(ctx: Ctx, deps: RouteDeps): Promise<void> {
  requireFounder(ctx);
  const id = pathParam(ctx, 'id');
  const key = idem(ctx);
  const order = await getOrder(id);
  if (!order) throw AppError.notFound();
  if (order.state !== 'receipted') throw AppError.invalidTransition();
  const paidAt = order.paid_at ?? new Date();
  if (Date.now() - paidAt.getTime() > config.refundWindowSeconds * 1000) {
    throw new AppError(409, 'refund_window_closed', 'Refunds close 30 days after payment.');
  }
  const remaining = order.net_cents - order.refunded_net_cents;
  const body = ctx.body<RefundBody>();
  const net = typeof body.net_cents === 'number' && Number.isInteger(body.net_cents) ? body.net_cents : null;
  if (net === null || net < 1 || net > remaining) {
    throw AppError.validation({ net_cents: `Refund between $0.01 and $${(remaining / 100).toFixed(2)}.` });
  }
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 300) : '';
  const killbillProbe = deps.checks.latest.get('killbill');
  if (killbillProbe && !killbillProbe.reachable) throw AppError.paymentsUnavailable();
  const rawBody = (ctx.req as unknown as { __bodyText?: string }).__bodyText ?? '';
  const stored = await transaction(async (tx) => {
    const found = await idemLookup(tx, ctx.user!.id, 'POST', `/api/admin/orders/${id}/refunds`, key, rawBody);
    if (found && !found.inProgress) return found.replay;
    if (found?.inProgress) throw new AppError(409, 'idempotency_in_progress', 'That request is still running.');
    await idemBegin(tx, ctx.user!.id, 'POST', `/api/admin/orders/${id}/refunds`, key, rawBody);
    return null;
  });
  if (stored) {
    sendJson(ctx.res, stored.status, stored.body, { 'Idempotent-Replayed': 'true' });
    return;
  }

  const vat = vatOf(net, order.vat_rate_percent);
  const gross = net + vat;
  let kbRefundId: string | null = null;
  try {
    const payments = await deps.services.killbill.getInvoicePayments(order.killbill_invoice_id!);
    const payment = payments.find((p) => paymentSucceeded(p));
    if (!payment) throw new Error('no_successful_payment');
    const refunded = await deps.services.killbill.refundPayment(payment.paymentId, gross, `refund_${id}_${net}`);
    kbRefundId = refunded.paymentId;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'killbill_unreachable') throw AppError.paymentsUnavailable();
    throw new Error(`killbill refund failed: ${message}`);
  }
  const refundId = `rfd_${randomUUID()}`;
  const full = net === remaining;
  const creditNote = await transaction(async (tx) => {
    const number = await nextCreditNoteNumber(tx, new Date());
    await tx.query(
      `INSERT INTO refunds (id, order_id, net_cents, vat_cents, gross_cents, credit_note_number, reason, killbill_refund_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [refundId, id, net, vat, gross, number, reason, kbRefundId]
    );
    const saleRows = await saleSplitRows(tx, id);
    const partyRows = full
      ? remainingRows(saleRows)
      : refundAllocation(net, saleRows);
    for (const row of partyRows) {
      await tx.query(
        `INSERT INTO split_rows (order_id, refund_id, party, holder_id, kind, amount_cents) VALUES ($1,$2,$3,$4,'refund',$5)`,
        [id, refundId, row.party, saleRows.find((r) => r.party === row.party)?.holder_id ?? 'platform', -row.amount_cents]
      );
    }
    await tx.query(
      `UPDATE orders SET refunded_net_cents = refunded_net_cents + $2, state = $3 WHERE id = $1`,
      [id, net, full ? 'refunded' : 'receipted']
    );
    return number;
  });

  // Credit note PDF and notice, with the 30-second retry when Gotenberg is down.
  const notice = refundNoticeEmail(creditNote, '', order.invoice_number ?? '');
  await transaction(async (tx) => {
    const row = await tx.one<{ credit_note_pdf: boolean }>(`SELECT credit_note_pdf FROM refunds WHERE id = $1`, [refundId]);
    if (row && !row.credit_note_pdf) {
      try {
        const pdf = await renderPdf(creditNoteHtml({
          credit_note_number: creditNote, invoice_number: order.invoice_number ?? '',
          net_cents: net, vat_rate: order.vat_rate_percent, vat_cents: vat, gross_cents: gross
        }));
        const year = new Date().getUTCFullYear();
        await deps.services.storage.put(`credit-notes/${year}/${creditNote}.pdf`, pdf, 'application/pdf');
        await tx.query(`UPDATE refunds SET credit_note_pdf = true WHERE id = $1`, [refundId]);
        notice.attachments = [{ filename: `${creditNote}.pdf`, contentType: 'application/pdf', base64: pdf.toString('base64') }];
      } catch {
        // Gotenberg down; the 30-second retry renders it later.
      }
    }
    notice.to = order.email;
    await queueMail(tx, 'refund_notice', notice);
  });

  const refundBody = {
    refund: {
      id: refundId,
      credit_note_number: creditNote,
      net_cents: net,
      vat_cents: vat,
      gross_cents: gross,
      rows: await query<{ party: string; holder_id: string; amount_cents: number }>(
        `SELECT party, holder_id, amount_cents FROM split_rows WHERE refund_id = $1 ORDER BY id`,
        [refundId]
      ).then((rows) => rows.map((row) => ({ party: row.party, holder: row.holder_id, kind: 'refund', amount_cents: row.amount_cents, refund_id: refundId })))
    }
  };
  await transaction(async (tx) => {
    await idemFinish(tx, ctx.user!.id, 'POST', `/api/admin/orders/${id}/refunds`, key, 201, refundBody);
  });
  sendJson(ctx.res, 201, refundBody);
}

function remainingRows(saleRows: { party: string; holder_id: string; amount_cents: number }[]): { party: string; amount_cents: number }[] {
  return saleRows.map((row) => ({ party: row.party, amount_cents: row.amount_cents }));
}

export async function adminCreditLedger(ctx: Ctx): Promise<void> {
  requireFounder(ctx);
  const entries = await query<{ id: string; kind: string; render_id: string | null; created_at: Date }>(
    `SELECT id::text AS id, kind, render_id, created_at FROM credit_entries ORDER BY id DESC`
  );
  const rows = await query<{ entry_id: string; account: string; amount: number }>(
    `SELECT entry_id::text AS entry_id, account, amount FROM credit_rows ORDER BY id`
  );
  const balances = new Map<string, number>();
  for (const row of rows) balances.set(row.account, (balances.get(row.account) ?? 0) + row.amount);
  const accountNames = [...new Set(rows.map((r) => r.account))].sort();
  const rowsByEntry = new Map<string, { account: string; amount: number }[]>();
  for (const row of rows) {
    const list = rowsByEntry.get(row.entry_id) ?? [];
    list.push({ account: row.account, amount: row.amount });
    rowsByEntry.set(row.entry_id, list);
  }
  sendJson(ctx.res, 200, {
    accounts: accountNames.map((account) => ({ account, balance: balances.get(account) ?? 0 })),
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind as 'grant' | 'pack' | 'reserve' | 'capture' | 'release',
      render_id: entry.render_id,
      created_at: new Date(entry.created_at).toISOString(),
      rows: rowsByEntry.get(entry.id) ?? []
    }))
  });
}

export async function adminRenders(ctx: Ctx): Promise<void> {
  requireFounder(ctx);
  const state = ctx.url.searchParams.get('state');
  const rows = await query<Record<string, unknown>>(
    state
      ? `SELECT id, piece_slug, state, failure_reason, cost_credits, attempts, format, resolution, duration_s, aspect, sha256, history::text AS history_json, created_at FROM renders WHERE state = $1 ORDER BY created_at DESC`
      : `SELECT id, piece_slug, state, failure_reason, cost_credits, attempts, format, resolution, duration_s, aspect, sha256, history::text AS history_json, created_at FROM renders ORDER BY created_at DESC`,
    state ? [state] : []
  );
  sendJson(ctx.res, 200, { renders: rows.map((row) => renderRowOut(row)) });
}

export async function adminServices(ctx: Ctx, deps: RouteDeps): Promise<void> {
  requireFounder(ctx);
  const order: ServiceName[] = ['killbill', 'render_provider', 'gotenberg', 'mail', 'storage'];
  sendJson(ctx.res, 200, {
    services: order.map((name) => {
      const status = deps.checks.latest.get(name);
      return { name, reachable: status?.reachable ?? false, checked_at: status?.checked_at ?? new Date(0).toISOString() };
    })
  });
}

type ServiceName = 'killbill' | 'render_provider' | 'gotenberg' | 'mail' | 'storage';

interface CloseBody { period?: unknown }

export async function adminCloseStatements(ctx: Ctx, deps: RouteDeps): Promise<void> {
  requireFounder(ctx);
  const body = ctx.body<CloseBody>();
  const period = typeof body.period === 'string' ? body.period : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw AppError.validation({ period: 'Send a month as YYYY-MM.' });
  const now = new Date();
  const closeAt = periodCloseDate(period);
  if (closeAt.getTime() > now.getTime()) {
    throw new AppError(409, 'period_open', `${periodLabel(period)} is still open.`);
  }
  const result = await transaction(async (tx) => {
    const existing = await tx.one<{ status: string }>(`SELECT status FROM statements WHERE period = $1 FOR UPDATE`, [period]);
    if (existing?.status === 'closed') return { closed: true };
    await tx.query(
      `INSERT INTO statements (period, status, closed_at) VALUES ($1,'closed',now())
       ON CONFLICT (period) DO UPDATE SET status = 'closed', closed_at = now()`,
      [period]
    );
    return { closed: false };
  });
  if (result.closed) throw new AppError(409, 'period_closed', 'That period is already closed.');
  const label = periodLabel(period);
  const creatorRows = await query<{ holder_id: string; display_name: string; email: string }>(
    `SELECT DISTINCT sr.holder_id, u.display_name, u.email
     FROM split_rows sr
     JOIN users u ON u.id = sr.holder_id
     JOIN orders o ON o.id = sr.order_id
     LEFT JOIN refunds r ON r.id = sr.refund_id
     WHERE sr.holder_id <> 'platform'
       AND ((sr.kind = 'sale' AND to_char(o.paid_at, 'YYYY-MM') = $1)
         OR (sr.kind = 'refund' AND to_char(r.created_at, 'YYYY-MM') = $1))`,
    [period]
  );
  let sent = 0;
  for (const creator of creatorRows) {
    const lines = await query<{ date: string; piece_title: string; edition: number; kind: string; party: string; amount_cents: number }>(
      `SELECT to_char(COALESCE(o.paid_at, r.created_at), 'YYYY-MM-DD') AS date, p.title AS piece_title, o.edition, sr.kind, sr.party, sr.amount_cents
       FROM split_rows sr
       JOIN orders o ON o.id = sr.order_id
       JOIN pieces p ON p.slug = o.piece_slug
       LEFT JOIN refunds r ON r.id = sr.refund_id
       WHERE sr.holder_id = $1
         AND ((sr.kind = 'sale' AND to_char(o.paid_at, 'YYYY-MM') = $2)
           OR (sr.kind = 'refund' AND to_char(r.created_at, 'YYYY-MM') = $2))`,
      [creator.holder_id, period]
    );
    const total = lines.reduce((sum, line) => sum + line.amount_cents, 0);
    const pdf = await renderPdf(statementHtml({
      period_label: label,
      creator_name: creator.display_name,
      lines: lines.map((line) => ({ date: line.date, piece_title: line.piece_title, edition: line.edition, kind: statementLineKind(line.party, line.kind), amount_cents: line.amount_cents })),
      total_cents: total
    })).catch(() => null);
    if (!pdf) continue;
    await deps.services.storage.put(`statements/${period}/${creator.holder_id}.pdf`, pdf, 'application/pdf').catch(() => null);
    const email = statementEmail(label, pdf.toString('base64'));
    email.to = creator.email;
    await transaction(async (tx) => {
      await queueMail(tx, 'statement', email);
    });
    sent += 1;
  }
  sendJson(ctx.res, 201, { period, creators: creatorRows.length });
}

function periodLabel(period: string): string {
  const [year, month] = period.split('-').map((part) => Number(part));
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[month - 1]} ${year}`;
}

function periodCloseDate(period: string): Date {
  const [year, month] = period.split('-').map((part) => Number(part));
  return new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
}

// ---------------------------------------------------------------- plans, credits, statements

export async function myCredits(ctx: Ctx): Promise<void> {
  const user = requireAny(ctx);
  const bal = await transaction(async (tx) => credits.balance(tx, user.id));
  const entries = await query<{ id: string; kind: string; render_id: string | null; created_at: Date }>(
    `SELECT e.id::text AS id, e.kind, e.render_id, e.created_at FROM credit_entries e
     JOIN credit_rows r ON r.entry_id = e.id
     WHERE r.account IN ($1, $2) ORDER BY e.id DESC`,
    [`creator:${user.id}:available`, `creator:${user.id}:held`]
  );
  sendJson(ctx.res, 200, { available: bal.available, held: bal.held, entries: entries.map((entry) => ({ id: entry.id, kind: entry.kind, render_id: entry.render_id, created_at: new Date(entry.created_at).toISOString(), rows: [] })) });
}

export async function myPlan(ctx: Ctx): Promise<void> {
  const user = requireAny(ctx);
  const row = await query<{ code: string; state: string; ends_on: Date | null }>(
    `SELECT code, state, ends_on FROM plans WHERE user_id = $1`, [user.id]
  );
  if (row.length === 0) {
    sendJson(ctx.res, 200, { plan: null });
    return;
  }
  sendJson(ctx.res, 200, {
    plan: {
      code: row[0].code as 'studio-monthly' | 'pro-monthly',
      state: row[0].state as 'pending_payment' | 'active' | 'cancelling' | 'ended',
      ends_on: row[0].ends_on ? new Date(row[0].ends_on).toISOString().slice(0, 10) : null
    }
  });
}

interface PlanBody { plan?: unknown }

export async function choosePlan(ctx: Ctx, deps: RouteDeps): Promise<void> {
  const user = requireAny(ctx);
  requireCreator(ctx);
  const body = ctx.body<PlanBody>();
  const plan = typeof body.plan === 'string' && ['studio-monthly', 'pro-monthly'].includes(body.plan) ? body.plan : null;
  if (!plan) throw AppError.validation({ plan: 'Choose the Studio or Pro plan.' });
  const existing = await query<{ state: string }>(`SELECT state FROM plans WHERE user_id = $1`, [user.id]);
  if (existing.length > 0 && ['pending_payment', 'active', 'cancelling'].includes(existing[0].state)) {
    throw new AppError(409, 'plan_exists', 'You already have a plan.');
  }
  const killbillProbe = deps.checks.latest.get('killbill');
  if (killbillProbe && !killbillProbe.reachable) throw AppError.paymentsUnavailable();
  const account = await deps.services.killbill.ensureAccount(user.id, user.display_name, user.email);
  if (!account) throw AppError.paymentsUnavailable();
  let subscriptionId: string | null = null;
  try {
    const sub = await deps.services.killbill.createSubscription(account.accountId, plan, `plan_${user.id}`);
    subscriptionId = sub.subscriptionId;
    // Pay the subscription's first invoice with the external payment method.
    for (const invoice of await deps.services.killbill.accountInvoices(account.accountId)) {
      const detail = await deps.services.killbill.getInvoice(invoice.invoiceId);
      if (!detail?.items?.some((item) => item.subscriptionId === subscriptionId)) continue;
      const payments = await deps.services.killbill.getInvoicePayments(invoice.invoiceId);
      if (payments.some((p) => paymentSucceeded(p))) continue;
      const detail2 = await deps.services.killbill.getInvoice(invoice.invoiceId);
      await deps.services.killbill.payInvoice(invoice.invoiceId, account.accountId, Math.round((detail2?.balance ?? detail2?.amount ?? invoice.amount) * 100), `plan_${subscriptionId}`);
      break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'killbill_unreachable') throw AppError.paymentsUnavailable();
    throw new Error(`killbill plan failed: ${message}`);
  }
  await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO plans (user_id, code, state, killbill_account_id, killbill_subscription_id)
       VALUES ($1,$2,'pending_payment',$3,$4)
       ON CONFLICT (user_id) DO UPDATE SET code = $2, state = 'pending_payment', killbill_account_id = $3, killbill_subscription_id = $4, ends_on = NULL`,
      [user.id, plan, account.accountId, subscriptionId]
    );
  });
  sendJson(ctx.res, 202, {
    plan: { code: plan as 'studio-monthly' | 'pro-monthly', state: 'pending_payment' as const, ends_on: null }
  });
}

export async function cancelPlan(ctx: Ctx, deps: RouteDeps): Promise<void> {
  const user = requireAny(ctx);
  const row = await query<{ code: string; state: string; killbill_subscription_id: string | null }>(
    `SELECT code, state, killbill_subscription_id FROM plans WHERE user_id = $1`, [user.id]
  );
  if (row.length === 0) throw AppError.invalidTransition();
  if (row[0].state === 'pending_payment') throw new AppError(409, 'plan_not_confirmed', 'Your plan can be cancelled once Kill Bill confirms it.');
  if (row[0].state !== 'active') throw AppError.invalidTransition();
  const killbillProbe = deps.checks.latest.get('killbill');
  if (killbillProbe && !killbillProbe.reachable) throw AppError.paymentsUnavailable();
  let endsOn: string | null = null;
  try {
    const result = await deps.services.killbill.cancelSubscription(row[0].killbill_subscription_id!);
    endsOn = result.chargedThroughDate ? result.chargedThroughDate.slice(0, 10) : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'killbill_unreachable') throw AppError.paymentsUnavailable();
    throw new Error(`killbill cancel failed: ${message}`);
  }
  await transaction(async (tx) => {
    await tx.query(`UPDATE plans SET state = 'cancelling', ends_on = $2 WHERE user_id = $1`, [user.id, endsOn]);
  });
  sendJson(ctx.res, 200, {
    plan: { code: row[0].code as 'studio-monthly' | 'pro-monthly', state: 'cancelling' as const, ends_on: endsOn }
  });
}

interface PackBody { pack?: unknown }

export async function buyPack(ctx: Ctx, deps: RouteDeps): Promise<void> {
  const user = requireAny(ctx);
  requireCreator(ctx);
  const key = idem(ctx);
  const body = ctx.body<PackBody>();
  if (body.pack !== 'pack-500') throw AppError.validation({ pack: 'Choose the 500 credit pack.' });
  const killbillProbe = deps.checks.latest.get('killbill');
  if (killbillProbe && !killbillProbe.reachable) throw AppError.paymentsUnavailable();
  const rawBody = (ctx.req as unknown as { __bodyText?: string }).__bodyText ?? '';
  const stored = await transaction(async (tx) => {
    const found = await idemLookup(tx, user.id, 'POST', '/api/me/credit-packs', key, rawBody);
    if (found && !found.inProgress) return found.replay;
    if (found?.inProgress) throw new AppError(409, 'idempotency_in_progress', 'That request is still running.');
    await idemBegin(tx, user.id, 'POST', '/api/me/credit-packs', key, rawBody);
    return null;
  });
  if (stored) {
    sendJson(ctx.res, stored.status, stored.body, { 'Idempotent-Replayed': 'true' });
    return;
  }
  const id = `pack_${randomUUID()}`;
  let kbInvoiceId: string | null = null;
  try {
    const account = await deps.services.killbill.ensureAccount(user.id, user.display_name, user.email);
    if (!account) throw new Error('killbill_unreachable');
    const invoice = await deps.services.killbill.createChargeInvoice(account.accountId, 1900, 'Credit pack — 500 credits');
    await deps.services.killbill.payInvoice(invoice.invoiceId, account.accountId, 1900, `pack_${id}`);
    kbInvoiceId = invoice.invoiceId;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'killbill_unreachable') throw AppError.paymentsUnavailable();
    throw new Error(`killbill pack failed: ${message}`);
  }
  await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO credit_packs (id, user_id, state, credits, price_cents, killbill_invoice_id) VALUES ($1,$2,'paying',500,1900,$3)`,
      [id, user.id, kbInvoiceId]
    );
  });
  const bodyOut = { purchase: { id, state: 'paying' as const, credits: 500, price_cents: 1900 } };
  await transaction(async (tx) => {
    await idemFinish(tx, user.id, 'POST', '/api/me/credit-packs', key, 202, bodyOut);
  });
  sendJson(ctx.res, 202, bodyOut);
}

export async function getPack(ctx: Ctx): Promise<void> {
  const id = pathParam(ctx, 'id');
  const user = requireAny(ctx);
  const rows = await query<{ state: string; credits: number; price_cents: number }>(
    `SELECT state, credits, price_cents FROM credit_packs WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  );
  if (rows.length === 0) throw AppError.notFound();
  sendJson(ctx.res, 200, { purchase: { id, state: rows[0].state as 'paying' | 'paid' | 'failed', credits: rows[0].credits, price_cents: rows[0].price_cents } });
}

function statementLineKind(party: string, kind: string): 'sale' | 'remix_sale' | 'royalty' | 'refund' {
  if (kind === 'refund') return 'refund';
  if (party === 'royalty') return 'royalty';
  if (party === 'remixer') return 'remix_sale';
  return 'sale';
}

export async function myStatements(ctx: Ctx): Promise<void> {
  const user = requireAny(ctx);
  const period = pathParam(ctx, 'period');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw AppError.notFound();
  const statusRow = await query<{ status: string }>(`SELECT status FROM statements WHERE period = $1`, [period]);
  const lines = await query<{ date: string; piece_title: string; edition: number; kind: string; party: string; amount_cents: number }>(
    `SELECT to_char(COALESCE(o.paid_at, r.created_at), 'YYYY-MM-DD') AS date, p.title AS piece_title, o.edition, sr.kind, sr.party, sr.amount_cents
     FROM split_rows sr
     JOIN orders o ON o.id = sr.order_id
     JOIN pieces p ON p.slug = o.piece_slug
     LEFT JOIN refunds r ON r.id = sr.refund_id
     WHERE sr.holder_id = $1
       AND ((sr.kind = 'sale' AND to_char(o.paid_at, 'YYYY-MM') = $2)
         OR (sr.kind = 'refund' AND to_char(r.created_at, 'YYYY-MM') = $2))`,
    [user.id, period]
  );
  const total = lines.reduce((sum, line) => sum + line.amount_cents, 0);
  sendJson(ctx.res, 200, {
    period,
    status: (statusRow[0]?.status ?? 'open') as 'open' | 'closed',
    lines: lines.map((line) => ({
      date: line.date,
      piece_title: line.piece_title,
      edition: line.edition,
      kind: statementLineKind(line.party, line.kind),
      amount_cents: line.amount_cents
    })),
    total_cents: total
  });
}

// ---------------------------------------------------------------- studio list

export async function myStudioPieces(ctx: Ctx): Promise<void> {
  const user = requireAny(ctx);
  const rows = await query<{ slug: string }>(
    `SELECT slug FROM pieces WHERE creator_id = $1 ORDER BY created_at DESC`,
    [user.id]
  );
  const pieces = await Promise.all(rows.map(async (row) => {
    const piece = await getPiece(row.slug);
    if (!piece) return null;
    const left = piece.state === 'published' ? await editionsLeft(row.slug) : null;
    return {
      slug: piece.slug,
      title: piece.title,
      state: piece.state,
      version: piece.version,
      engine: 'GLSL' as const,
      creator: { id: piece.creator_id, display_name: piece.creator_name },
      uniforms: piece.uniforms,
      timeline: piece.timeline,
      remix_of: piece.remix_of_slug ? { slug: piece.remix_of_slug, title: piece.remix_of_title ?? '', creator_display_name: piece.remix_of_creator ?? '' } : null,
      edition_count: piece.edition_count,
      price_cents: piece.price_cents,
      editions_left: left,
      export_render_id: piece.export_render_id
    };
  }));
  sendJson(ctx.res, 200, { pieces: pieces.filter((p) => p !== null) });
}
