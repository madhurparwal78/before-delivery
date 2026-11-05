import { Router, type RequestContext, validationError } from '../http/types.js';
import { ApiError } from '../errors.js';
import { search, type SearchHit } from '../providers/search.js';
import { hasPendingRemovals, getModelBySlug, type ModelRow } from '../domain/models.js';
import { publicAccess, verifyModelPassword, unlockCookieValue, type ViewerContext, type Viewer } from '../domain/access.js';
import { bodyOf } from '../http/body.js';
import { sendJson, sendRaw } from '../http/respond.js';
import { currentPriceCents } from '../domain/commerce.js';
import { editionRemaining } from '../domain/commerce.js';
import { one } from '../db/db.js';
import { serializeCookie } from '../http/cookies.js';
import { sessionSecret } from '../server-context.js';

export interface CatalogueParams {
  q: string;
  category: string[];
  licence: string[];
  format: string[];
  sort: 'newest' | 'price_asc' | 'price_desc';
  page: number;
}

const CATEGORIES = ['hard-surface', 'miniature', 'scan'];
const LICENCES = ['personal', 'commercial', 'studio'];
const FORMATS = ['glb', 'stl'];

export function parseCatalogueParams(query: URLSearchParams): CatalogueParams {
  const fields: Record<string, string> = {};
  const q = query.get('q') ?? '';
  if (q.length > 100) fields['q'] = 'Keep the search to 100 characters.';
  const category = (query.get('category') ?? '').split(',').map(v => v.trim()).filter(v => v !== '');
  const licence = (query.get('licence') ?? '').split(',').map(v => v.trim()).filter(v => v !== '');
  const format = (query.get('format') ?? '').split(',').map(v => v.trim()).filter(v => v !== '');
  for (const value of category) if (!CATEGORIES.includes(value)) fields['category'] = 'Choose one of the listed values.';
  for (const value of licence) if (!LICENCES.includes(value)) fields['licence'] = 'Choose one of the listed values.';
  for (const value of format) if (!FORMATS.includes(value)) fields['format'] = 'Choose one of the listed values.';
  const sortParam = query.get('sort');
  const sort = sortParam === null || sortParam === '' ? 'newest' : sortParam;
  if (!['newest', 'price_asc', 'price_desc'].includes(sort)) fields['sort'] = 'Choose one of the listed values.';
  const pageParam = query.get('page') ?? '1';
  const page = Number.parseInt(pageParam, 10);
  if (!Number.isInteger(page) || page < 1) fields['page'] = 'Use a whole number of 1 or more.';
  if (Object.keys(fields).length > 0) throw validationError(fields);
  return { q, category, licence, format, sort: sort as CatalogueParams['sort'], page: Number.isFinite(page) ? page : 1 };
}

export interface Card {
  slug: string;
  title: string;
  category: string;
  formats: string[];
  licences: string[];
  price_from_cents: number;
  preview_url: string;
  rebuilding: boolean;
}

export function cardOf(hit: SearchHit): Card {
  return {
    slug: hit.slug,
    title: hit.title,
    category: hit.category,
    formats: hit.formats,
    licences: hit.licences,
    price_from_cents: hit.price_from_cents,
    preview_url: `/media/${hit.slug}/preview.png`,
    rebuilding: hit.rebuilding,
  };
}

async function searchOrUnavailable(): Promise<void> {
  if (await hasPendingRemovals()) throw new ApiError(503, 'search_unavailable');
}

export async function catalogueResult(params: CatalogueParams): Promise<{
  total: number;
  page: number;
  page_size: number;
  pages: number;
  items: Card[];
  facets: { category: Record<string, number>; licence: Record<string, number>; format: Record<string, number> };
}> {
  await searchOrUnavailable();
  let result;
  try {
    result = await search({
      q: params.q,
      category: params.category,
      licence: params.licence,
      format: params.format,
      sort: params.sort,
      page: params.page,
      perPage: 8,
      withFacets: true,
    });
  } catch {
    throw new ApiError(503, 'search_unavailable');
  }
  return {
    total: result.total,
    page: params.page,
    page_size: 8,
    pages: Math.max(1, Math.ceil(result.total / 8)),
    items: result.hits.map(cardOf),
    facets: result.facets,
  };
}

export interface ModelDetail {
  slug: string;
  title: string;
  category: string;
  description: string;
  formats: string[];
  licences: { type: string; seats: number; list_price_cents: number; price_cents: number }[];
  discount_percent: number;
  dimensions_mm: { width: number; height: number; depth: number };
  bounding_radius_mm: number;
  scale_denominator: number;
  default_camera: { azimuth: number; tilt: number; distance: number; fov: number };
  hotspots: { label: string; x_mm: number; y_mm: number; z_mm: number }[];
  edition: { total: number; remaining: number; price_cents: number } | null;
  rebuilding: boolean;
}

export function modelDetailOf(model: ModelRow, viewerKind: Viewer['kind']): ModelDetail {
  const licences: ModelDetail['licences'] = [
    { type: 'personal', seats: 1, list_price_cents: model.price_personal_cents, price_cents: currentPriceCents(model, 'personal') ?? model.price_personal_cents },
  ];
  if (model.price_commercial_cents !== null) {
    licences.push({ type: 'commercial', seats: 1, list_price_cents: model.price_commercial_cents, price_cents: currentPriceCents(model, 'commercial') ?? 0 });
  }
  if (model.price_studio_cents !== null) {
    licences.push({ type: 'studio', seats: 3, list_price_cents: model.price_studio_cents, price_cents: currentPriceCents(model, 'studio') ?? 0 });
  }
  void viewerKind;
  return {
    slug: model.slug,
    title: model.title,
    category: model.category,
    description: model.description,
    formats: [...(model.has_glb ? ['glb'] : []), ...(model.has_stl ? ['stl'] : [])],
    licences,
    discount_percent: model.discount_percent,
    dimensions_mm: {
      width: Number(model.width_mm),
      height: Number(model.height_mm),
      depth: Number(model.depth_mm),
    },
    bounding_radius_mm: Number(model.bounding_radius_mm),
    scale_denominator: model.scale_denominator,
    default_camera: {
      azimuth: model.cam_azimuth,
      tilt: model.cam_tilt,
      distance: model.cam_distance_factor,
      fov: model.cam_fov,
    },
    hotspots: model.hotspots ?? [],
    edition:
      model.edition_total !== null
        ? { total: model.edition_total, remaining: 0, price_cents: model.edition_price_cents ?? 0 }
        : null,
    rebuilding: model.rebuilding || model.outdated,
  };
}

export function viewerContextOf(ctx: RequestContext, viewer: Viewer, slug?: string): ViewerContext {
  return {
    viewer,
    unlockCookie: slug === undefined ? undefined : ctx.cookies[`unlock_${slug}`],
    accessToken: ctx.query.get('access') ?? undefined,
  };
}

export function registerPublicRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/catalogue',
    allowedParams: ['q', 'category', 'licence', 'format', 'sort', 'page'],
    handler: async ctx => {
      const params = parseCatalogueParams(ctx.query);
      const result = await catalogueResult(params);
      sendJson(ctx, 200, result);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/models/:slug',
    allowedParams: ['access'],
    handler: async ctx => {
      const model = await getModelBySlug(ctx.params['slug'] ?? '');
      const viewer: Viewer = { kind: 'public' };
      if (model === null) throw new ApiError(404, 'not_found');
      const access = await publicAccess(model, viewerContextOf(ctx, viewer, model.slug), await sessionSecret());
      if (!access.allowed) throw new ApiError(404, 'not_found');
      if (access.passwordGate) throw new ApiError(403, 'password_required');
      const detail = modelDetailOf(model, 'public');
      if (detail.edition !== null) {
        detail.edition.remaining = await editionRemaining(model.id);
      }
      sendJson(ctx, 200, detail);
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/models/:slug/unlock',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      const model = await getModelBySlug(ctx.params['slug'] ?? '');
      if (model === null || model.visibility !== 'password' || model.state !== 'published' || model.read_only) {
        throw new ApiError(404, 'not_found');
      }
      const body = bodyOf(ctx);
      const password = typeof body['password'] === 'string' ? body['password'] : '';
      if (Array.from(password).length === 0) {
        throw new ApiError(403, 'wrong_password');
      }
      const ok = await verifyModelPassword(model, password);
      if (!ok) throw new ApiError(403, 'wrong_password');
      ctx.res.setHeader(
        'Set-Cookie',
        serializeCookie(`unlock_${model.slug}`, unlockCookieValue(model.slug, model.password_epoch, await sessionSecret()), {
          httpOnly: true,
          sameSite: 'Lax',
          session: true,
        }),
      );
      sendJson(ctx, 204, null);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/shared/:token',
    allowedParams: [],
    handler: async ctx => {
      const token = ctx.params['token'] ?? '';
      const row = await one<{ slug: string }>(
        'SELECT m.slug FROM share_tokens s JOIN models m ON m.id = s.model_id WHERE s.token = $1',
        [token],
      );
      const model = row === null ? null : await getModelBySlug(row.slug);
      if (model === null || model.visibility !== 'unlisted' || model.state !== 'published' || model.read_only) {
        throw new ApiError(404, 'not_found');
      }
      const detail = modelDetailOf(model, 'public');
      if (detail.edition !== null) detail.edition.remaining = await editionRemaining(model.id);
      sendJson(ctx, 200, detail);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/models/:slug/recommendations',
    allowedParams: [],
    handler: async ctx => {
      await searchOrUnavailable();
      const model = await getModelBySlug(ctx.params['slug'] ?? '');
      if (model === null) throw new ApiError(404, 'not_found');
      let result;
      try {
        result = await search({ q: '', category: [], licence: [], format: [], sort: 'newest', page: 1, perPage: 5, withFacets: false });
      } catch {
        throw new ApiError(503, 'search_unavailable');
      }
      const items = result.hits.filter(hit => hit.slug !== model.slug).slice(0, 4).map(cardOf);
      sendJson(ctx, 200, { items });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/models/:slug/edition',
    allowedParams: ['access'],
    handler: async ctx => {
      const model = await getModelBySlug(ctx.params['slug'] ?? '');
      const viewer: Viewer = { kind: 'public' };
      if (model === null) throw new ApiError(404, 'not_found');
      const access = await publicAccess(model, viewerContextOf(ctx, viewer, model.slug), await sessionSecret());
      if (!access.allowed || access.passwordGate) throw new ApiError(404, 'not_found');
      if (model.edition_total === null) throw new ApiError(404, 'not_found');
      sendJson(ctx, 200, {
        total: model.edition_total,
        remaining: await editionRemaining(model.id),
        on_sale: model.state === 'published',
      });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/media/:slug/preview.png',
    allowedParams: ['access'],
    handler: async ctx => serveMedia(ctx, 'preview.png'),
  });
  router.add({
    method: 'GET',
    pattern: '/media/:slug/view.glb',
    allowedParams: ['access'],
    handler: async ctx => serveMedia(ctx, 'view.glb'),
  });
}

async function serveMedia(ctx: RequestContext, file: 'preview.png' | 'view.glb'): Promise<void> {
  const { serveModelFile } = await import('./media.js');
  await serveModelFile(ctx, ctx.params['slug'] ?? '', file);
}

export function viewerForUser(user: { role: string } | null): Viewer {
  if (user === null) return { kind: 'public' };
  if (user.role === 'author' || user.role === 'editor') return { kind: 'studio', role: user.role as 'author' | 'editor' };
  if (user.role === 'contributor') return { kind: 'contributor', role: 'contributor' };
  return { kind: 'public' };
}
