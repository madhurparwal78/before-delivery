import { Router, type RequestContext } from '../http/types.js';
import { ApiError } from '../errors.js';
import { sendJson } from '../http/respond.js';
import { search, allIndexed } from '../providers/search.js';
import { hasPendingRemovals, getModelBySlug } from '../domain/models.js';
import { currentPriceCents } from '../domain/commerce.js';
import { findActiveKey, checkKeyInPlan, checkRateLimit, rateLimitedError } from '../domain/api-keys.js';

const READ_PARAMS = ['q', 'category', 'licence', 'format', 'sort', 'page'];

/** The read API: two routes, published fields only, key auth and per-key rate limits. */
export function registerReadApiRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/v1/models',
    allowedParams: READ_PARAMS,
    handler: async ctx => {
      const key = await authenticate(ctx);
      const limit = await checkRateLimit(key);
      ctx.res.setHeader('X-RateLimit-Limit', '60');
      ctx.res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
      if (limit.retryAfter !== null) throw rateLimitedError(limit.retryAfter);
      if (await hasPendingRemovals()) throw new ApiError(503, 'search_unavailable');
      const { parseCatalogueParams } = await import('./public.js');
      const params = parseCatalogueParams(ctx.query);
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
          withFacets: false,
        });
      } catch {
        throw new ApiError(503, 'search_unavailable');
      }
      sendJson(ctx, 200, {
        total: result.total,
        page: params.page,
        page_size: 8,
        items: result.hits.map(hit => ({
          slug: hit.slug,
          title: hit.title,
          category: hit.category,
          formats: hit.formats,
          licences: hit.licences,
          price_from_cents: hit.price_from_cents,
          url: `/models/${hit.slug}`,
        })),
      });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/v1/models/:slug',
    allowedParams: [],
    handler: async ctx => {
      const key = await authenticate(ctx);
      const limit = await checkRateLimit(key);
      ctx.res.setHeader('X-RateLimit-Limit', '60');
      ctx.res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
      if (limit.retryAfter !== null) throw rateLimitedError(limit.retryAfter);
      if (await hasPendingRemovals()) throw new ApiError(503, 'search_unavailable');
      let hits;
      try {
        hits = await allIndexed({});
      } catch {
        throw new ApiError(503, 'search_unavailable');
      }
      const hit = hits.find(candidate => candidate.slug === ctx.params['slug']);
      if (hit === undefined) throw new ApiError(404, 'not_found');
      const model = await getModelBySlug(hit.slug);
      if (model === null) throw new ApiError(404, 'not_found');
      const licences = hit.licences.map(licence => {
        if (licence === 'personal') {
          return { type: 'personal', price_cents: currentPriceCents(model, 'personal') ?? 0 };
        }
        if (licence === 'commercial') {
          return { type: 'commercial', price_cents: currentPriceCents(model, 'commercial') ?? 0 };
        }
        return { type: 'studio', price_cents: currentPriceCents(model, 'studio') ?? 0 };
      });
      sendJson(ctx, 200, {
        slug: hit.slug,
        title: hit.title,
        category: hit.category,
        description: hit.description,
        formats: hit.formats,
        licences,
        dimensions_mm: {
          width: Number(model.width_mm),
          height: Number(model.height_mm),
          depth: Number(model.depth_mm),
        },
        url: `/models/${hit.slug}`,
      });
    },
  });
}

async function authenticate(ctx: RequestContext) {
  const header = ctx.req.headers['authorization'] ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (match === null) throw new ApiError(401, 'invalid_api_key');
  const token = match[1] ?? '';
  const { hashKey } = await import('../domain/api-keys.js');
  const { query } = await import('../db/db.js');
  const row = await query<{ ref: string }>('SELECT ref FROM api_keys WHERE key_hash = $1 AND active = true', [hashKey(token)]);
  const found = row.rows[0];
  if (found === undefined) throw new ApiError(401, 'invalid_api_key');
  const key = await findActiveKey(found.ref);
  if (key === null) throw new ApiError(401, 'invalid_api_key');
  await checkKeyInPlan(key);
  return key;
}
