import { createHash } from 'node:crypto';
import type { Reply, RequestContext } from '../http/router.js';
import { json } from '../http/router.js';
import { ApiError, notFound, rateLimited } from '../http/errors.js';
import { query } from '../db/pool.js';
import { activePlan } from '../db/plan.js';
import { plan } from '../domain/plans.js';
import { findModelBySlug } from '../db/models.js';
import { belongsInSearchIndex } from '../domain/model.js';
import { licenceLines } from './access.js';
import { parseSelection, runCatalogue } from './catalogue.js';

const WINDOW_MS = 60_000;
const LIMIT = 60;

interface Window {
  readonly stamps: number[];
}

const windows = new Map<string, Window>();

/** Each key may make 60 requests in any rolling 60 seconds. */
function takeSlot(keyRef: string): { remaining: number; retryAfter: number | null } {
  const now = Date.now();
  const window = windows.get(keyRef) ?? { stamps: [] };
  windows.set(keyRef, window);
  while (window.stamps.length > 0 && now - (window.stamps[0] ?? 0) >= WINDOW_MS) {
    window.stamps.shift();
  }
  if (window.stamps.length >= LIMIT) {
    const oldest = window.stamps[0] ?? now;
    const waitMs = WINDOW_MS - (now - oldest);
    return { remaining: 0, retryAfter: Math.max(1, Math.min(60, Math.ceil(waitMs / 1000))) };
  }
  window.stamps.push(now);
  return { remaining: LIMIT - window.stamps.length, retryAfter: null };
}

interface KeyRow {
  key_ref: string;
  created_at: Date;
}

/**
 * Only active keys count. Keys beyond the active plan's allowance, ranked by
 * creation, answer `not_in_plan` when used.
 */
async function authenticateKey(ctx: RequestContext): Promise<string> {
  const header = ctx.req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : null;
  if (token === null || token === '') throw new ApiError('invalid_api_key');

  const hash = createHash('sha256').update(token).digest('hex');
  const active = await query<KeyRow>(
    `SELECT key_ref, created_at FROM read_keys WHERE revoked_at IS NULL ORDER BY created_at, id`,
  );
  const matched = await query<KeyRow>(
    `SELECT key_ref, created_at FROM read_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hash],
  );
  const found = matched[0];
  if (found === undefined) throw new ApiError('invalid_api_key');

  const allowance = plan(await activePlan()).readKeys;
  const rank = active.findIndex((k) => k.key_ref === found.key_ref);
  if (rank < 0 || rank >= allowance) throw new ApiError('not_in_plan');
  return found.key_ref;
}

function rateHeaders(remaining: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(LIMIT),
    'X-RateLimit-Remaining': String(remaining),
  };
}

async function guard(ctx: RequestContext): Promise<Record<string, string>> {
  const keyRef = await authenticateKey(ctx);
  const slot = takeSlot(keyRef);
  if (slot.retryAfter !== null) {
    const error = rateLimited(slot.retryAfter);
    throw new ApiError(error.code, {
      params: error.params,
      headers: { ...error.headers, ...rateHeaders(0) },
    });
  }
  return rateHeaders(slot.remaining);
}

export async function listHandler(ctx: RequestContext): Promise<Reply> {
  const headers = await guard(ctx);
  const selection = parseSelection(ctx.query);
  const result = await runCatalogue(selection);
  return json(
    200,
    {
      total: result.total,
      page: result.page,
      page_size: result.page_size,
      items: result.items.map((item) => ({
        slug: item.slug,
        title: item.title,
        category: item.category,
        formats: item.formats,
        licences: item.licences,
        price_from_cents: item.price_from_cents,
        url: `/models/${item.slug}`,
      })),
    },
    { headers },
  );
}

export async function detailHandler(ctx: RequestContext): Promise<Reply> {
  const headers = await guard(ctx);
  const model = await findModelBySlug(ctx.params.slug ?? '', await activePlan());
  if (model === null || !belongsInSearchIndex(model)) throw notFound();
  return json(
    200,
    {
      slug: model.slug,
      title: model.title,
      category: model.category,
      description: model.description,
      formats: model.formats,
      licences: licenceLines(model).map((l) => ({ type: l.type, price_cents: l.price_cents })),
      dimensions_mm: { width: model.widthMm, height: model.heightMm, depth: model.depthMm },
      url: `/models/${model.slug}`,
    },
    { headers },
  );
}
