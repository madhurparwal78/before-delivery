import { route } from '../http/app.js';
import { empty, html, redirect } from '../http/router.js';
import type { Reply, RequestContext } from '../http/router.js';
import { ApiError, isApiError, notFound } from '../http/errors.js';
import { destroySession } from '../db/users.js';
import { clearCookie } from '../http/cookies.js';
import { SESSION_COOKIE } from '../http/app.js';
import type { Locale } from '../shared/locale.js';
import { s } from '../shared/strings.js';
import { errorMessage } from '../shared/copy.js';
import type { Role } from '../domain/session.js';
import { landingRoute, mayOpenPage, requiresSignIn } from '../domain/session.js';
import { link, studioBannerCopy } from './layout.js';
import type { PageBase } from './public.js';
import {
  cataloguePage,
  embedPage,
  modelPage,
  passwordGatePage,
  receiptPage,
  signInPage,
  simpleMessagePage,
} from './public.js';
import {
  apiKeysPage,
  collectionsPage,
  dashboardPage,
  exportPage,
  planPage,
  queuePage,
  reviewPage,
  studioModelPage,
  uploadPage,
} from './studio-pages.js';
import type { ModelRow, StudioShell } from './studio-pages.js';
import { contributePage, orderDetailPage, staffPage } from './role-pages.js';
import { parseSelection, runCatalogue } from '../api/catalogue.js';
import type { CatalogueCard } from '../api/catalogue.js';
import { modelDetail, resolvePublicModel, resolveSharedModel } from '../api/access.js';
import { embedIsLive } from '../api/access.js';
import {
  allModels,
  catalogueTotals,
  findModelByEmbedToken,
  findModelBySlug,
  modelsOwnedBy,
} from '../db/models.js';
import { activePlan, activePlanState, quotaFor, refreshPlanState } from '../db/plan.js';
import { latestUploadForModel, latestUploads, queueStatusFor } from '../db/uploads.js';
import { findOrderByReceiptToken, findOrderByRef, findOrdersByEmail } from '../db/orders.js';
import { upgradeOptionsFor } from '../api/receipts.js';
import { search } from '../services/search.js';
import { currentHealth, SERVICE_NAMES } from '../services/health.js';
import type { ServiceName } from '../services/health.js';
import { priceFromCents } from '../services/indexer.js';
import { queueCounts } from '../db/uploads.js';
import { query } from '../db/pool.js';
import { ORDER_REF_RE } from '../domain/identifiers.js';
import { isValidEmail } from '../domain/text.js';
import { collectionsHandlerSet } from '../api/collections.js';
import { PAGE_SIZE } from '../api/catalogue.js';

function downServices(): readonly ServiceName[] {
  const health = currentHealth();
  return SERVICE_NAMES.filter((name) => health.services[name] === 'down');
}

function baseFor(ctx: RequestContext, role: Role | null, banner: string | null): PageBase {
  return { locale: ctx.locale, lang: ctx.lang, role, banner };
}

/** The public banner names only the search outage visitors can feel. */
function publicBanner(locale: Locale): string | null {
  return downServices().includes('search') ? errorMessage('search_unavailable', locale) : null;
}

function requirePageRole(ctx: RequestContext, ...roles: readonly Role[]): Role {
  const session = ctx.session;
  if (session === null) throw new ApiError('unauthenticated');
  if (!roles.includes(session.role)) throw new ApiError('forbidden');
  return session.role;
}

/** Signed-out page requests to a role area redirect to sign-in with `next`. */
function guardArea(ctx: RequestContext): Reply | null {
  if (!requiresSignIn(ctx.path)) return null;
  if (ctx.session === null) {
    return redirect(link(`/sign-in?next=${encodeURIComponent(ctx.path)}`, ctx.lang), 302);
  }
  if (!mayOpenPage(ctx.session.role, ctx.path)) throw new ApiError('forbidden');
  return null;
}

async function studioShell(ctx: RequestContext, role: Role, current: string): Promise<StudioShell> {
  return {
    locale: ctx.locale,
    lang: ctx.lang,
    role,
    current,
    title: s('studio', ctx.locale),
    banner: studioBannerCopy(downServices(), ctx.locale),
  };
}

async function modelRows(): Promise<readonly ModelRow[]> {
  const models = await allModels(await activePlan());
  const rows: ModelRow[] = [];
  for (const model of models) {
    rows.push({
      slug: model.slug,
      title: model.title,
      state: model.state,
      visibility: model.visibility,
      read_only: model.readOnly,
      price_from_cents: priceFromCents(model),
      queue_status: await queueStatusFor(model.id),
    });
  }
  return rows;
}

async function recommendationCards(
  slug: string,
  category: string,
): Promise<readonly CatalogueCard[]> {
  try {
    const result = await search({
      q: '',
      category: [category as 'hard-surface'],
      licence: [],
      format: [],
      sort: 'newest',
      page: 1,
      pageSize: PAGE_SIZE,
    });
    return result.hits
      .filter((hit) => hit.slug !== slug)
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
  } catch {
    // The model page still renders when search is down; the banner explains it.
    return [];
  }
}

async function cataloguePageHandler(ctx: RequestContext): Promise<Reply> {
  const selection = parseSelection(ctx.query);
  const result = await runCatalogue(selection);
  return html(
    200,
    cataloguePage(baseFor(ctx, ctx.session?.role ?? null, publicBanner(ctx.locale)), selection, result),
  );
}

async function modelPageHandler(ctx: RequestContext): Promise<Reply> {
  const slug = ctx.params.slug ?? '';
  let model;
  try {
    model = await resolvePublicModel(ctx, slug);
  } catch (error) {
    if (isApiError(error) && error.code === 'password_required') {
      const locked = await findModelBySlug(slug, await activePlan());
      if (locked === null) throw notFound();
      return html(
        403,
        passwordGatePage(
          baseFor(ctx, ctx.session?.role ?? null, publicBanner(ctx.locale)),
          locked.title,
          locked.slug,
        ),
      );
    }
    throw error;
  }
  const detail = await modelDetail(model);
  return html(
    200,
    modelPage(baseFor(ctx, ctx.session?.role ?? null, publicBanner(ctx.locale)), {
      model,
      detail,
      recommendations: await recommendationCards(model.slug, model.category),
      accessToken: null,
    }),
  );
}

async function sharePageHandler(ctx: RequestContext): Promise<Reply> {
  const token = ctx.params.token ?? '';
  let model;
  try {
    model = await resolveSharedModel(token);
  } catch {
    return html(
      404,
      simpleMessagePage(baseFor(ctx, ctx.session?.role ?? null, null), s('shareDead', ctx.locale)),
    );
  }
  const detail = await modelDetail(model);
  return html(
    200,
    modelPage(baseFor(ctx, ctx.session?.role ?? null, publicBanner(ctx.locale)), {
      model,
      detail,
      recommendations: await recommendationCards(model.slug, model.category),
      accessToken: token,
    }),
  );
}

async function embedPageHandler(ctx: RequestContext): Promise<Reply> {
  const token = ctx.params.token ?? '';
  const model = await findModelByEmbedToken(token, await activePlan());
  if (model === null || !(await embedIsLive(model))) {
    return html(
      404,
      simpleMessagePage(baseFor(ctx, null, null), s('embedUnavailable', ctx.locale)),
    );
  }
  const detail = await modelDetail(model);
  return html(
    200,
    embedPage(baseFor(ctx, null, null), {
      model,
      detail,
      recommendations: [],
      accessToken: token,
    }),
  );
}

async function receiptPageHandler(ctx: RequestContext): Promise<Reply> {
  const order = await findOrderByReceiptToken(ctx.params.token ?? '');
  if (order === null) throw notFound();
  // A receipt address without `lang` reads in the order's checkout locale.
  const locale: Locale = ctx.lang === null ? order.locale : ctx.locale;
  return html(
    200,
    receiptPage(
      { locale, lang: ctx.lang, role: ctx.session?.role ?? null, banner: null },
      { order, upgradeOptions: await upgradeOptionsFor(order) },
    ),
  );
}

async function signInPageHandler(ctx: RequestContext): Promise<Reply> {
  if (ctx.session !== null) {
    return redirect(link(landingRoute(ctx.session.role), ctx.lang), 302);
  }
  return html(200, signInPage(baseFor(ctx, null, null), ctx.query.get('next')));
}

async function signOutHandler(ctx: RequestContext): Promise<Reply> {
  if (ctx.session !== null) await destroySession(ctx.session.id);
  return empty(303, {
    headers: { Location: link('/catalogue', ctx.lang) },
    cookies: [clearCookie(SESSION_COOKIE)],
  });
}

async function dashboardHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const role = requirePageRole(ctx, 'author', 'editor');
  const state = await activePlanState();
  return html(
    200,
    dashboardPage(await studioShell(ctx, role, '/studio'), {
      totals: await catalogueTotals(),
      quota: await quotaFor(state),
      models: await modelRows(),
      uploads: await latestUploads(5),
    }),
  );
}

async function uploadPageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const role = requirePageRole(ctx, 'author');
  return html(200, uploadPage(await studioShell(ctx, role, '/studio/upload')));
}

async function reviewPageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const role = requirePageRole(ctx, 'author', 'editor');
  const models = await allModels(await activePlan());
  const rows = [];
  for (const model of models) {
    if (model.state !== 'in_review') continue;
    rows.push({
      slug: model.slug,
      title: model.title,
      state: model.state,
      visibility: model.visibility,
      read_only: model.readOnly,
      price_from_cents: priceFromCents(model),
      queue_status: await queueStatusFor(model.id),
      owner: model.ownerRole === 'author' ? 'author' : model.ownerEmail,
    });
  }
  return html(200, reviewPage(await studioShell(ctx, role, '/studio/review'), rows));
}

async function collectionsPageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const role = requirePageRole(ctx, 'author', 'editor');
  const reply = await collectionsHandlerSet.list(ctx);
  const items = (reply.json as { items: never[] }).items;
  const models = await allModels(await activePlan());
  const titles = new Map(models.map((m) => [m.slug, m.title]));
  return html(
    200,
    collectionsPage(
      await studioShell(ctx, role, '/studio/collections'),
      items,
      titles,
      models.map((m) => ({ slug: m.slug, title: m.title })),
    ),
  );
}

async function planPageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const role = requirePageRole(ctx, 'author');
  const state = await refreshPlanState();
  return html(
    200,
    planPage(await studioShell(ctx, role, '/studio/plan'), {
      current: state.plan,
      pending:
        state.pendingPlan === null || state.pendingEffectiveDate === null
          ? null
          : { plan: state.pendingPlan, effective_date: state.pendingEffectiveDate },
      quota: await quotaFor(state),
    }),
  );
}

async function apiKeysPageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const role = requirePageRole(ctx, 'author');
  const rows = await query<{ key_ref: string; name: string; created_at: Date; revoked_at: Date | null }>(
    `SELECT key_ref, name, created_at, revoked_at FROM read_keys ORDER BY created_at, id`,
  );
  return html(
    200,
    apiKeysPage(
      await studioShell(ctx, role, '/studio/api-keys'),
      rows.map((r) => ({
        ref: r.key_ref,
        name: r.name,
        created_at: r.created_at.toISOString(),
        active: r.revoked_at === null,
      })),
    ),
  );
}

async function exportPageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const role = requirePageRole(ctx, 'author');
  return html(200, exportPage(await studioShell(ctx, role, '/studio/export')));
}

async function studioModelPageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const role = requirePageRole(ctx, 'author', 'editor');
  const model = await findModelBySlug(ctx.params.slug ?? '', await activePlan());
  if (model === null) throw notFound();
  const embeds = await query<{ token: string }>(
    `SELECT token FROM embeds WHERE model_id = $1 ORDER BY id`,
    [model.id],
  );
  const upload = await latestUploadForModel(model.id);
  return html(
    200,
    studioModelPage(await studioShell(ctx, role, '/studio/models'), {
      detail: await modelDetail(model),
      state: model.state,
      visibility: model.visibility,
      readOnly: model.readOnly,
      shareUrl: model.shareToken === null ? null : `/u/${model.shareToken}`,
      embeds: embeds.map((e) => ({ token: e.token, url: `/embed/${e.token}` })),
      latestUpload: upload?.uploadRef ?? null,
      owner: model.ownerRole === 'author' ? 'author' : model.ownerEmail,
      prices: {
        personal: model.personalCents,
        commercial: model.commercialCents,
        studio: model.studioCents,
      },
    }),
  );
}

async function studioQueuePageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const role = requirePageRole(ctx, 'author', 'editor');
  const model = await findModelBySlug(ctx.params.slug ?? '', await activePlan());
  if (model === null) throw notFound();
  return html(
    200,
    queuePage(await studioShell(ctx, role, '/studio/models'), {
      slug: model.slug,
      upload: await latestUploadForModel(model.id),
      contributor: false,
      canSubmit: false,
    }),
  );
}

async function contributePageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const session = ctx.session;
  requirePageRole(ctx, 'contributor');
  if (session === null) throw new ApiError('unauthenticated');
  const models = await modelsOwnedBy(session.userId, await activePlan());
  const rows: ModelRow[] = [];
  for (const model of models) {
    rows.push({
      slug: model.slug,
      title: model.title,
      state: model.state,
      visibility: model.visibility,
      read_only: model.readOnly,
      price_from_cents: priceFromCents(model),
      queue_status: await queueStatusFor(model.id),
    });
  }
  return html(
    200,
    contributePage(baseFor(ctx, 'contributor', null), {
      models: rows,
      drafts: models
        .filter((m) => m.state === 'draft')
        .map((m) => ({ slug: m.slug, title: m.title })),
    }),
  );
}

async function contributeQueuePageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  const session = ctx.session;
  requirePageRole(ctx, 'contributor');
  if (session === null) throw new ApiError('unauthenticated');
  const model = await findModelBySlug(ctx.params.slug ?? '', await activePlan());
  if (model === null || model.ownerUserId !== session.userId) throw notFound();
  return html(
    200,
    queuePage(
      {
        locale: ctx.locale,
        lang: ctx.lang,
        role: 'contributor',
        current: '/contribute',
        title: s('queueHeading', ctx.locale),
        banner: null,
      },
      {
        slug: model.slug,
        upload: await latestUploadForModel(model.id),
        contributor: true,
        canSubmit: model.state === 'draft',
      },
    ),
  );
}

async function staffPageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  requirePageRole(ctx, 'staff');
  const lookup = ctx.query.get('q') ?? '';
  const orders = ORDER_REF_RE.test(lookup)
    ? await findOrderByRef(lookup).then((o) => (o === null ? [] : [o]))
    : isValidEmail(lookup)
      ? await findOrdersByEmail(lookup)
      : [];
  return html(
    200,
    staffPage(baseFor(ctx, 'staff', null), {
      orders,
      health: currentHealth(),
      queue: await queueCounts(),
      lookup,
    }),
  );
}

async function staffOrderPageHandler(ctx: RequestContext): Promise<Reply> {
  const redirectReply = guardArea(ctx);
  if (redirectReply !== null) return redirectReply;
  requirePageRole(ctx, 'staff');
  const order = await findOrderByRef(ctx.params.order ?? '');
  if (order === null) throw notFound();
  return html(
    200,
    orderDetailPage(baseFor(ctx, 'staff', null), {
      order,
      health: currentHealth(),
      queue: await queueCounts(),
    }),
  );
}

export function registerPageRoutes(): void {
  const pageRoute = (
    pattern: string,
    handler: (ctx: RequestContext) => Promise<Reply>,
    method = 'GET',
  ): void => {
    route({ method, pattern, surface: 'page', body: 'none', handler });
  };

  pageRoute('/', async (ctx) => redirect(link('/catalogue', ctx.lang), 302));
  pageRoute('/catalogue', cataloguePageHandler);
  pageRoute('/models/:slug', modelPageHandler);
  pageRoute('/u/:token', sharePageHandler);
  pageRoute('/embed/:token', embedPageHandler);
  pageRoute('/receipts/:token', receiptPageHandler);
  pageRoute('/sign-in', signInPageHandler);
  pageRoute('/sign-out', signOutHandler, 'POST');

  pageRoute('/studio', dashboardHandler);
  pageRoute('/studio/upload', uploadPageHandler);
  pageRoute('/studio/review', reviewPageHandler);
  pageRoute('/studio/collections', collectionsPageHandler);
  pageRoute('/studio/plan', planPageHandler);
  pageRoute('/studio/api-keys', apiKeysPageHandler);
  pageRoute('/studio/export', exportPageHandler);
  pageRoute('/studio/models/:slug', studioModelPageHandler);
  pageRoute('/studio/models/:slug/queue', studioQueuePageHandler);

  pageRoute('/contribute', contributePageHandler);
  pageRoute('/contribute/models/:slug', contributeQueuePageHandler);

  pageRoute('/staff', staffPageHandler);
  pageRoute('/staff/orders/:order', staffOrderPageHandler);
}

