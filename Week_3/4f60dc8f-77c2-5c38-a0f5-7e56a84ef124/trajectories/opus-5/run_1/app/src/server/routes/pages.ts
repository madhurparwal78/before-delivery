import { RATE_CURRENCIES, formatRate } from '../../shared/money.js';
import { fail } from '../http/app-error.js';
import { route, sendHtml, type Ctx, type Route } from '../http/kernel.js';
import { findEngagement, listAllEngagements, listBrandEngagements } from '../db/engagements.js';
import { contactOfRole } from '../db/brands.js';
import { listRates } from '../db/fx.js';
import { brandEngagement, hasStudioSession, optionalClientSession } from '../app/auth.js';
import { contentForPage, publicCaseStudy, servicesForRead } from '../app/content.js';
import { settleOverdue } from '../app/billing.js';
import { buildReviewView, resolveReviewToken } from '../app/review.js';
import { healthView } from '../app/status.js';
import { recordInEffect } from '../domain/fx.js';
import { engagementView, loadEngagementBundle, studioEngagementView } from '../serialise.js';
import {
  accountPage,
  caseStudyPage,
  engagementPage,
  homePage,
  reviewPage,
  rigPage,
  signInPage,
  startPage,
  studioDashboardPage,
  studioEngagementPage,
  studioSignInPage,
} from '../views/pages.js';

const redirectToSignIn = (ctx: Ctx): void => {
  const next = `${ctx.url.pathname}${ctx.url.search}`;
  ctx.response.writeHead(302, {
    Location: `/sign-in?next=${encodeURIComponent(next)}`,
    'Cache-Control': 'no-store',
  });
  ctx.response.end();
};

export const pageRoutes: Route[] = [
  route('GET', '/', async (ctx) => {
    sendHtml(ctx, 200, homePage(await contentForPage()));
  }),

  route('GET', '/work/:slug', async (ctx) => {
    const study = await publicCaseStudy(ctx.params.slug).catch(() => null);
    if (study === null) fail('not_found');
    sendHtml(ctx, 200, caseStudyPage(study as NonNullable<typeof study>));
  }),

  route('GET', '/start', async (ctx) => {
    sendHtml(ctx, 200, startPage());
  }),

  route('GET', '/sign-in', async (ctx) => {
    sendHtml(ctx, 200, signInPage(ctx.url.searchParams.get('next')));
  }),

  route('GET', '/account', async (ctx) => {
    const session = await optionalClientSession(ctx);
    if (session === null) {
      redirectToSignIn(ctx);
      return;
    }
    const engagements = await listBrandEngagements(session.brand.id);
    sendHtml(
      ctx,
      200,
      accountPage(
        engagements.map((engagement) => ({
          id: engagement.id,
          reference: engagement.reference,
          title: engagement.title,
          state: engagement.state,
        })),
      ),
    );
  }),

  route('GET', '/account/engagements/:id', async (ctx) => {
    const session = await optionalClientSession(ctx);
    if (session === null) {
      redirectToSignIn(ctx);
      return;
    }
    const engagement = await brandEngagement(session.brand.id, ctx.params.id);
    await settleOverdue(engagement.id);
    const refreshed = await brandEngagement(session.brand.id, engagement.id);
    const bundle = await loadEngagementBundle(refreshed, await servicesForRead(), await listRates());
    sendHtml(ctx, 200, engagementPage(engagementView(bundle, 'client')));
  }),

  route('GET', '/rig/:id', async (ctx) => {
    const session = await optionalClientSession(ctx);
    if (session === null) {
      redirectToSignIn(ctx);
      return;
    }
    const engagement = await brandEngagement(session.brand.id, ctx.params.id);
    const services = await servicesForRead();
    const bundle = await loadEngagementBundle(engagement, services, await listRates());
    const finance = await contactOfRole(engagement.brand_id, 'finance');
    sendHtml(
      ctx,
      200,
      rigPage(engagementView(bundle, 'client'), services, finance?.email ?? ''),
    );
  }),

  route('GET', '/review/:token', async (ctx) => {
    const resolved = await resolveReviewToken(ctx.params.token);
    const review = await buildReviewView(resolved);
    sendHtml(ctx, 200, reviewPage(review, ctx.params.token), { 'Referrer-Policy': 'no-referrer' });
  }),

  route('GET', '/studio', async (ctx) => {
    if (!(await hasStudioSession(ctx))) {
      sendHtml(ctx, 200, studioSignInPage());
      return;
    }
    await settleOverdue(null);
    const [engagements, content, rates, health] = await Promise.all([
      listAllEngagements(),
      contentForPage(),
      listRates(),
      healthView(),
    ]);
    const now = new Date();
    sendHtml(
      ctx,
      200,
      studioDashboardPage({
        engagements: engagements.map((engagement) => ({
          id: engagement.id,
          reference: engagement.reference,
          title: engagement.title,
          state: engagement.state,
          brand_name: engagement.brand_name,
        })),
        caseStudies: content.allCaseStudies,
        services: content.services,
        rates: [
          ...RATE_CURRENCIES.flatMap((currency) => {
            const effective = recordInEffect(rates, currency, now);
            return effective === null
              ? []
              : [
                  {
                    currency,
                    rate: formatRate(effective.rateE4),
                    effective_at: effective.effectiveAt.toISOString(),
                    status: 'Current' as const,
                  },
                ];
          }),
          ...rates
            .filter((rate) => rate.effectiveAt > now)
            .sort(
              (a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime() || Number(a.seq - b.seq),
            )
            .map((rate) => ({
              currency: rate.currency,
              rate: formatRate(rate.rateE4),
              effective_at: rate.effectiveAt.toISOString(),
              status: 'Scheduled' as const,
            })),
        ],
        health,
      }),
    );
  }),

  route('GET', '/studio/engagements/:id', async (ctx) => {
    if (!(await hasStudioSession(ctx))) {
      sendHtml(ctx, 200, studioSignInPage());
      return;
    }
    await settleOverdue(ctx.params.id);
    const services = await servicesForRead();
    const engagement = await findEngagement(ctx.params.id);
    if (engagement === null) fail('not_found');
    const bundle = await loadEngagementBundle(
      engagement as NonNullable<typeof engagement>,
      services,
      await listRates(),
    );
    sendHtml(ctx, 200, studioEngagementPage(await studioEngagementView(bundle), services));
  }),
];
