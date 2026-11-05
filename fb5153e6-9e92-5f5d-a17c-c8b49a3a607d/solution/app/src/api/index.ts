import { route, SESSION_COOKIE } from '../http/app.js';
import { empty, json } from '../http/router.js';
import type { Reply, RequestContext } from '../http/router.js';
import { ApiError, notFound } from '../http/errors.js';
import { authenticate, createSession, destroySession, sessionSecret } from '../db/users.js';
import { landingRoute, verifyPassword } from '../domain/session.js';
import { clearCookie, serialiseCookie, sign } from '../http/cookies.js';
import { CATALOGUE_PARAMS, parseSelection, runCatalogue } from './catalogue.js';
import {
  editionBlock,
  hasValidUnlock,
  modelDetail,
  resolvePublicModel,
  resolveSharedModel,
  unlockCookieName,
  unlockCookieValue,
} from './access.js';
import { findModelBySlug } from '../db/models.js';
import { activePlan } from '../db/plan.js';
import { search } from '../services/search.js';
import { hasUnconfirmedRemoval } from '../services/indexer.js';
import { checkoutHandler } from './checkout.js';
import { invoicePdfHandler, receiptFileHandler, receiptHandler } from './receipts.js';
import { mediaHandler } from './media.js';
import * as studio from './studio.js';
import { collectionsHandlerSet } from './collections.js';
import * as contrib from './contrib.js';
import * as staff from './staff.js';
import * as readapi from './readapi.js';
import { PAGE_SIZE } from './catalogue.js';

async function signInHandler(ctx: RequestContext): Promise<Reply> {
  const email = typeof ctx.body.email === 'string' ? ctx.body.email : '';
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const user = await authenticate(email, password);
  if (user === null) throw new ApiError('invalid_credentials');
  const id = await createSession(user.id);
  const cookie = serialiseCookie(SESSION_COOKIE, sign(id, await sessionSecret()), {
    maxAgeSeconds: 60 * 60 * 24 * 7,
  });
  return json(
    200,
    { role: user.role, landing: landingRoute(user.role) },
    { cookies: [cookie] },
  );
}

async function sessionHandler(ctx: RequestContext): Promise<Reply> {
  const session = ctx.session;
  if (session === null) throw new ApiError('unauthenticated');
  return json(200, {
    role: session.role,
    email: session.email,
    landing: landingRoute(session.role),
  });
}

async function signOutHandler(ctx: RequestContext): Promise<Reply> {
  if (ctx.session !== null) await destroySession(ctx.session.id);
  return empty(204, { cookies: [clearCookie(SESSION_COOKIE)] });
}

async function catalogueHandler(ctx: RequestContext): Promise<Reply> {
  return json(200, await runCatalogue(parseSelection(ctx.query)));
}

async function modelHandler(ctx: RequestContext): Promise<Reply> {
  return json(200, await modelDetail(await resolvePublicModel(ctx, ctx.params.slug ?? '')));
}

async function sharedHandler(ctx: RequestContext): Promise<Reply> {
  return json(200, await modelDetail(await resolveSharedModel(ctx.params.token ?? '')));
}

async function unlockHandler(ctx: RequestContext): Promise<Reply> {
  const model = await findModelBySlug(ctx.params.slug ?? '', await activePlan());
  if (
    model === null ||
    model.state !== 'published' ||
    !model.withinPlan ||
    model.visibility !== 'password' ||
    model.passwordHash === null
  ) {
    throw notFound();
  }
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (!(await verifyPassword(password, model.passwordHash))) throw new ApiError('wrong_password');
  return empty(204, {
    cookies: [serialiseCookie(unlockCookieName(model.slug), await unlockCookieValue(model))],
  });
}

/** Recommendations read the index, so they follow the same visibility rule. */
async function recommendationsHandler(ctx: RequestContext): Promise<Reply> {
  const model = await resolvePublicModel(ctx, ctx.params.slug ?? '');
  if (await hasUnconfirmedRemoval()) throw new ApiError('search_unavailable');
  const result = await search({
    q: '',
    category: [model.category],
    licence: [],
    format: [],
    sort: 'newest',
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const items = result.hits
    .filter((hit) => hit.slug !== model.slug)
    .slice(0, 4)
    .map((hit) => ({
      slug: hit.slug,
      title: hit.title,
      category: hit.category,
      formats: hit.formats,
      licences: hit.licences,
      price_from_cents: hit.price_from_cents,
      preview_url: `/media/${hit.slug}/preview.png`,
      rebuilding: hit.rebuilding,
    }));
  return json(200, { items });
}

async function editionHandler(ctx: RequestContext): Promise<Reply> {
  const model = await findModelBySlug(ctx.params.slug ?? '', await activePlan());
  if (model === null || model.editionTotal === null) throw notFound();
  const visible =
    model.state === 'published' &&
    model.withinPlan &&
    (model.visibility === 'public' ||
      (model.visibility === 'password' && (await hasValidUnlock(ctx, model))) ||
      (model.visibility === 'unlisted' && ctx.query.get('access') === model.shareToken));
  if (!visible) throw notFound();
  const block = await editionBlock(model);
  if (block === null) throw notFound();
  return json(200, {
    total: block.total,
    remaining: block.remaining,
    on_sale: block.remaining > 0,
  });
}

export function registerApiRoutes(): void {
  route({
    method: 'POST',
    pattern: '/api/session',
    surface: 'api',
    body: 'json',
    fields: ['email', 'password'],
    handler: signInHandler,
  });
  route({ method: 'GET', pattern: '/api/session', surface: 'api', body: 'none', handler: sessionHandler });
  route({ method: 'DELETE', pattern: '/api/session', surface: 'api', body: 'none', handler: signOutHandler });

  route({
    method: 'GET',
    pattern: '/api/catalogue',
    surface: 'api',
    body: 'none',
    query: [...CATALOGUE_PARAMS, 'lang'],
    handler: catalogueHandler,
  });
  route({ method: 'GET', pattern: '/api/models/:slug', surface: 'api', body: 'none', handler: modelHandler });
  route({
    method: 'POST',
    pattern: '/api/models/:slug/unlock',
    surface: 'api',
    body: 'json',
    fields: ['password'],
    handler: unlockHandler,
  });
  route({ method: 'GET', pattern: '/api/models/:slug/recommendations', surface: 'api', body: 'none', handler: recommendationsHandler });
  route({ method: 'GET', pattern: '/api/models/:slug/edition', surface: 'api', body: 'none', handler: editionHandler });
  route({ method: 'GET', pattern: '/api/shared/:token', surface: 'api', body: 'none', handler: sharedHandler });

  route({ method: 'GET', pattern: '/media/:slug/:file', surface: 'media', body: 'none', handler: mediaHandler });

  route({
    method: 'POST',
    pattern: '/api/checkout',
    surface: 'api',
    body: 'json',
    fields: ['model', 'licence', 'email', 'terms', 'locale', 'access', 'upgrade_from'],
    needsIdempotency: true,
    handler: checkoutHandler,
  });
  route({ method: 'GET', pattern: '/api/receipts/:token', surface: 'api', body: 'none', handler: receiptHandler });
  route({ method: 'GET', pattern: '/api/receipts/:token/invoice.pdf', surface: 'api', body: 'none', handler: invoicePdfHandler });
  route({ method: 'GET', pattern: '/api/receipts/:token/files/:file', surface: 'api', body: 'none', handler: receiptFileHandler });

  route({ method: 'GET', pattern: '/api/studio/summary', surface: 'api', body: 'none', handler: studio.summaryHandler });
  route({ method: 'GET', pattern: '/api/studio/models', surface: 'api', body: 'none', handler: studio.modelsHandler });
  route({ method: 'GET', pattern: '/api/studio/models/:slug', surface: 'api', body: 'none', handler: studio.modelDetailHandler });
  route({
    method: 'PATCH',
    pattern: '/api/studio/models/:slug',
    surface: 'api',
    body: 'json',
    fields: [
      'title',
      'description',
      'category',
      'visibility',
      'password',
      'prices',
      'discount_percent',
      'edition_total',
      'edition_price_cents',
    ],
    handler: studio.patchModelHandler,
  });
  route({ method: 'DELETE', pattern: '/api/studio/models/:slug', surface: 'api', body: 'none', handler: studio.deleteModelHandler });
  route({
    method: 'PUT',
    pattern: '/api/studio/models/:slug/view',
    surface: 'api',
    body: 'json',
    fields: ['default_camera', 'hotspots'],
    handler: studio.saveViewHandler,
  });
  route({
    method: 'POST',
    pattern: '/api/studio/models/:slug/transitions',
    surface: 'api',
    body: 'json',
    fields: ['to'],
    handler: studio.transitionHandler,
  });
  route({ method: 'GET', pattern: '/api/studio/models/:slug/original', surface: 'api', body: 'none', handler: studio.originalHandler });
  route({ method: 'POST', pattern: '/api/studio/models/:slug/share-link', surface: 'api', body: 'none', handler: studio.shareLinkHandler });
  route({ method: 'POST', pattern: '/api/studio/models/:slug/embeds', surface: 'api', body: 'none', handler: studio.createEmbedHandler });
  route({ method: 'DELETE', pattern: '/api/studio/embeds/:token', surface: 'api', body: 'none', handler: studio.deleteEmbedHandler });
  route({ method: 'POST', pattern: '/api/studio/uploads', surface: 'api', body: 'multipart', handler: studio.uploadHandler });
  route({ method: 'GET', pattern: '/api/studio/uploads/:ref', surface: 'api', body: 'none', handler: studio.uploadStatusHandler });
  route({ method: 'POST', pattern: '/api/studio/uploads/:ref/requeue', surface: 'api', body: 'none', handler: studio.requeueHandler });
  route({ method: 'GET', pattern: '/api/studio/exports/catalogue.csv', surface: 'api', body: 'none', handler: studio.exportHandler });
  route({ method: 'GET', pattern: '/api/studio/plan', surface: 'api', body: 'none', handler: studio.planHandler });
  route({
    method: 'POST',
    pattern: '/api/studio/plan',
    surface: 'api',
    body: 'json',
    fields: ['plan'],
    needsIdempotency: true,
    handler: studio.changePlanHandler,
  });
  route({ method: 'GET', pattern: '/api/studio/api-keys', surface: 'api', body: 'none', handler: studio.listKeysHandler });
  route({
    method: 'POST',
    pattern: '/api/studio/api-keys',
    surface: 'api',
    body: 'json',
    fields: ['name'],
    handler: studio.createKeyHandler,
  });
  route({ method: 'DELETE', pattern: '/api/studio/api-keys/:ref', surface: 'api', body: 'none', handler: studio.revokeKeyHandler });

  route({ method: 'GET', pattern: '/api/studio/collections', surface: 'api', body: 'none', handler: collectionsHandlerSet.list });
  route({
    method: 'POST',
    pattern: '/api/studio/collections',
    surface: 'api',
    body: 'json',
    fields: ['name'],
    handler: collectionsHandlerSet.create,
  });
  route({
    method: 'PATCH',
    pattern: '/api/studio/collections/:collection',
    surface: 'api',
    body: 'json',
    fields: ['name'],
    handler: collectionsHandlerSet.rename,
  });
  route({ method: 'DELETE', pattern: '/api/studio/collections/:collection', surface: 'api', body: 'none', handler: collectionsHandlerSet.remove });
  route({
    method: 'POST',
    pattern: '/api/studio/collections/:collection/items',
    surface: 'api',
    body: 'json',
    fields: ['model'],
    handler: collectionsHandlerSet.addItem,
  });
  route({ method: 'DELETE', pattern: '/api/studio/collections/:collection/items/:slug', surface: 'api', body: 'none', handler: collectionsHandlerSet.removeItem });
  route({
    method: 'POST',
    pattern: '/api/studio/collections/:collection/items/:slug/move',
    surface: 'api',
    body: 'json',
    fields: ['to'],
    handler: collectionsHandlerSet.moveItem,
  });

  route({ method: 'GET', pattern: '/api/contrib/models', surface: 'api', body: 'none', handler: contrib.listHandler });
  route({ method: 'POST', pattern: '/api/contrib/models', surface: 'api', body: 'multipart', handler: contrib.uploadHandler });
  route({ method: 'GET', pattern: '/api/contrib/models/:slug', surface: 'api', body: 'none', handler: contrib.detailHandler });
  route({ method: 'POST', pattern: '/api/contrib/models/:slug/submit', surface: 'api', body: 'none', handler: contrib.submitHandler });
  route({ method: 'GET', pattern: '/api/contrib/models/:slug/original', surface: 'api', body: 'none', handler: contrib.originalHandler });
  route({ method: 'GET', pattern: '/api/contrib/uploads/:ref', surface: 'api', body: 'none', handler: contrib.uploadStatusHandler });
  route({ method: 'POST', pattern: '/api/contrib/texture-sets', surface: 'api', body: 'multipart', handler: contrib.textureSetHandler });

  route({ method: 'GET', pattern: '/api/staff/orders', surface: 'api', body: 'none', handler: staff.ordersHandler });
  route({
    method: 'POST',
    pattern: '/api/staff/orders/:order/refunds',
    surface: 'api',
    body: 'json',
    fields: ['kind', 'seats'],
    needsIdempotency: true,
    handler: staff.refundHandler,
  });
  route({ method: 'GET', pattern: '/api/staff/health', surface: 'api', body: 'none', handler: staff.healthHandler });

  route({
    method: 'GET',
    pattern: '/api/v1/models',
    surface: 'read-api',
    body: 'none',
    query: CATALOGUE_PARAMS,
    handler: readapi.listHandler,
  });
  route({
    method: 'GET',
    pattern: '/api/v1/models/:slug',
    surface: 'read-api',
    body: 'none',
    query: [],
    handler: readapi.detailHandler,
  });
}

