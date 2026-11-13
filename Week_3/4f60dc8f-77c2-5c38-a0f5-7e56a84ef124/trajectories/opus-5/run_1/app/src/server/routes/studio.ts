import { pipeline } from 'node:stream/promises';
import { FIELD_COPY } from '../../shared/errors.js';
import {
  SCENE_ACCENTS,
  SCENE_PRIMITIVES,
  type CaseStudy,
  type ReviewMilestone,
  type ScenePrimitive,
} from '../../shared/domain.js';
import {
  RATE_CURRENCIES,
  formatRate,
  isCurrencyCode,
  parseRateToE4,
  type CurrencyCode,
} from '../../shared/money.js';
import { fail } from '../http/app-error.js';
import {
  appendSetCookie,
  clearCookie,
  readCookies,
  readJson,
  route,
  sendJson,
  sendNoContent,
  setCookie,
  requestOrigin,
  type Route,
} from '../http/kernel.js';
import { createSession, deleteSession } from '../db/brands.js';
import {
  findEngagement,
  findIntakeFile,
  findInvoice,
  listAllEngagements,
  listQuoteLines,
  upsertStill,
  type EngagementRow,
  type IntakeFileRow,
} from '../db/engagements.js';
import { insertRate, listRates } from '../db/fx.js';
import { STUDIO_COOKIE, requireStudioSession } from '../app/auth.js';
import { reindexFromPocketBase, servicesForRead, studioContent } from '../app/content.js';
import { cancelWithRefund, issueInvoice, settleOverdue } from '../app/billing.js';
import { readStillUpload, storeStill } from '../app/intake.js';
import { kickOutbox } from '../app/outbox-worker.js';
import {
  regenerateReviewLink,
  revokeReviewLink,
  sendForReview,
} from '../app/review.js';
import { healthView } from '../app/status.js';
import { studioPasswordHash, verifyPassword } from '../app/seed.js';
import { check } from '../app/validate.js';
import { stillPostAllowed } from '../domain/states.js';
import { recordInEffect } from '../domain/fx.js';
import { contentDisposition } from '../domain/intake.js';
import { createRecord, findRecordId, updateRecord } from '../services/pocketbase.js';
import { getObjectStream } from '../services/storage.js';
import { loadEngagementBundle, studioEngagementView } from '../serialise.js';

const studioEngagement = async (id: string): Promise<EngagementRow> => {
  const engagement = await findEngagement(id);
  if (engagement === null) fail('not_found');
  return engagement as EngagementRow;
};

const caseStudyFields = (body: Record<string, unknown>, partial: boolean): Partial<CaseStudy> => {
  const errors: Record<string, string> = {};
  const out: Partial<CaseStudy> = {};

  if (body.slug !== undefined || !partial) {
    if (typeof body.slug !== 'string' || !/^[a-z0-9-]{3,60}$/.test(body.slug))
      errors.slug = FIELD_COPY.slug;
    else out.slug = body.slug;
  }
  const textFields: { key: 'title' | 'client' | 'summary'; max: number; copy: string }[] = [
    { key: 'title', max: 120, copy: 'Enter a case study title.' },
    { key: 'client', max: 80, copy: 'Enter the client name.' },
    { key: 'summary', max: 2000, copy: 'Enter a summary.' },
  ];
  for (const { key, max, copy } of textFields) {
    if (body[key] === undefined && partial) continue;
    const value = body[key];
    if (typeof value !== 'string' || value.trim() === '' || value.length > max) errors[key] = copy;
    else out[key] = value;
  }
  if (body.scene !== undefined || !partial) {
    const scene = body.scene as { primitives?: unknown; accent?: unknown } | undefined;
    const primitives = Array.isArray(scene?.primitives) ? scene?.primitives : null;
    const accent = scene?.accent;
    const validPrimitives =
      primitives !== null &&
      primitives.length >= 1 &&
      primitives.length <= 8 &&
      primitives.every((entry) => (SCENE_PRIMITIVES as readonly string[]).includes(entry as string));
    const validAccent = (SCENE_ACCENTS as readonly string[]).includes(accent as string);
    if (!validPrimitives || !validAccent) errors.scene = FIELD_COPY.scene;
    else
      out.scene = {
        primitives: primitives as ScenePrimitive[],
        accent: accent as CaseStudy['scene']['accent'],
      };
  }
  if (body.published !== undefined) out.published = body.published === true;
  if (body.sort !== undefined) out.sort = Number(body.sort);
  check(errors);
  return out;
};

export const studioRoutes: Route[] = [
  route('POST', '/api/studio/session', async (ctx) => {
    const body = await readJson(ctx);
    const stored = await studioPasswordHash();
    if (
      typeof body.password !== 'string' ||
      stored === null ||
      !verifyPassword(body.password, stored)
    )
      fail('invalid_credentials');
    const token = await createSession('studio', null, null);
    appendSetCookie(ctx, setCookie(STUDIO_COOKIE, token));
    sendJson(ctx, 200, { role: 'founder' });
  }),

  route('DELETE', '/api/studio/session', async (ctx) => {
    const token = readCookies(ctx)[STUDIO_COOKIE];
    if (token !== undefined) await deleteSession(token);
    appendSetCookie(ctx, clearCookie(STUDIO_COOKIE));
    sendNoContent(ctx);
  }),

  route('GET', '/api/studio/health', async (ctx) => {
    await requireStudioSession(ctx);
    sendJson(ctx, 200, await healthView());
  }),

  route('GET', '/api/studio/engagements', async (ctx) => {
    await requireStudioSession(ctx);
    await settleOverdue(null);
    sendJson(ctx, 200, {
      engagements: (await listAllEngagements()).map((engagement) => ({
        id: engagement.id,
        reference: engagement.reference,
        title: engagement.title,
        state: engagement.state,
        brand_name: engagement.brand_name,
      })),
    });
  }),

  route('GET', '/api/studio/engagements/:id', async (ctx) => {
    await requireStudioSession(ctx);
    const engagement = await studioEngagement(ctx.params.id);
    await settleOverdue(engagement.id);
    const refreshed = await studioEngagement(engagement.id);
    const bundle = await loadEngagementBundle(refreshed, await servicesForRead(), await listRates());
    sendJson(ctx, 200, await studioEngagementView(bundle));
  }),

  route('GET', '/api/studio/engagements/:id/files/:file_id/content', async (ctx) => {
    await requireStudioSession(ctx);
    const engagement = await studioEngagement(ctx.params.id);
    const file = await findIntakeFile(ctx.params.file_id);
    if (file === null || file.engagement_id !== engagement.id) fail('not_found');
    const row = file as IntakeFileRow;
    const body = await getObjectStream(row.object_key);
    ctx.response.writeHead(200, {
      'Content-Type': row.content_type,
      'Content-Length': row.size_bytes,
      'Content-Disposition': contentDisposition(row.name),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    await pipeline(body, ctx.response);
  }),

  route('POST', '/api/studio/engagements/:id/stills', async (ctx) => {
    await requireStudioSession(ctx);
    const engagement = await studioEngagement(ctx.params.id);
    if (
      !stillPostAllowed({
        state: engagement.state,
        finalsOut: engagement.finals_out,
        revisionMilestone: engagement.revision_milestone,
      })
    )
      fail('invalid_state');
    const upload = await readStillUpload(ctx);
    const quoteLines = await listQuoteLines(engagement.id);
    const errors: Record<string, string> = {};
    if (upload.milestone !== 'look_dev' && upload.milestone !== 'final_delivery')
      errors.milestone = FIELD_COPY.milestone;
    if (!quoteLines.some((line) => line.shot_code === upload.shotCode))
      errors.shot_code = FIELD_COPY.shot_code;
    check(errors);
    const milestone = upload.milestone as ReviewMilestone;
    const { objectKey } = await storeStill(engagement.id, milestone, upload);
    const still = await upsertStill({
      engagementId: engagement.id,
      shotCode: upload.shotCode,
      milestone,
      objectKey,
      contentType: upload.contentType,
    });
    sendJson(ctx, 201, {
      id: still.id,
      shot_code: still.shot_code,
      milestone: still.milestone,
    });
  }),

  route('POST', '/api/studio/engagements/:id/send-for-review', async (ctx) => {
    await requireStudioSession(ctx);
    const engagement = await studioEngagement(ctx.params.id);
    const issued = await sendForReview(engagement.id, requestOrigin(ctx));
    kickOutbox();
    const refreshed = await studioEngagement(engagement.id);
    const bundle = await loadEngagementBundle(refreshed, await servicesForRead(), await listRates());
    sendJson(ctx, 200, {
      engagement: await studioEngagementView(bundle),
      review_url: issued.reviewUrl,
      expires_at: issued.expiresAt.toISOString(),
    });
  }),

  route('POST', '/api/studio/engagements/:id/review-link', async (ctx) => {
    await requireStudioSession(ctx);
    const engagement = await studioEngagement(ctx.params.id);
    const issued = await regenerateReviewLink(engagement.id, requestOrigin(ctx));
    kickOutbox();
    sendJson(ctx, 201, {
      review_url: issued.reviewUrl,
      expires_at: issued.expiresAt.toISOString(),
    });
  }),

  route('DELETE', '/api/studio/engagements/:id/review-link', async (ctx) => {
    await requireStudioSession(ctx);
    const engagement = await studioEngagement(ctx.params.id);
    await revokeReviewLink(engagement.id);
    sendNoContent(ctx);
  }),

  route('POST', '/api/studio/invoices/:invoice_id/issue', async (ctx) => {
    await requireStudioSession(ctx);
    const invoice = await findInvoice(ctx.params.invoice_id);
    if (invoice === null) fail('not_found');
    const result = await issueInvoice((invoice as NonNullable<typeof invoice>).id);
    kickOutbox();
    sendJson(ctx, 200, result);
  }),

  route('POST', '/api/studio/engagements/:id/cancel', async (ctx) => {
    await requireStudioSession(ctx);
    const engagement = await studioEngagement(ctx.params.id);
    const body = await readJson(ctx);
    const result = await cancelWithRefund(engagement.id, body.refund_minor);
    kickOutbox();
    sendJson(ctx, 200, result);
  }),

  route('GET', '/api/studio/fx-rates', async (ctx) => {
    await requireStudioSession(ctx);
    const rates = await listRates();
    const now = new Date();
    sendJson(ctx, 200, {
      rates: RATE_CURRENCIES.flatMap((currency) => {
        const effective = recordInEffect(rates, currency, now);
        return effective === null
          ? []
          : [
              {
                currency,
                rate: formatRate(effective.rateE4),
                effective_at: effective.effectiveAt.toISOString(),
              },
            ];
      }),
      scheduled: rates
        .filter((rate) => rate.effectiveAt > now)
        .sort(
          (a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime() || Number(a.seq - b.seq),
        )
        .map((rate) => ({
          currency: rate.currency,
          rate: formatRate(rate.rateE4),
          effective_at: rate.effectiveAt.toISOString(),
        })),
    });
  }),

  route('POST', '/api/studio/fx-rates', async (ctx) => {
    await requireStudioSession(ctx);
    const body = await readJson(ctx);
    const arrival = new Date();
    const errors: Record<string, string> = {};
    const currency = body.currency;
    if (
      !isCurrencyCode(currency) ||
      !RATE_CURRENCIES.includes(currency as CurrencyCode)
    )
      errors.currency = FIELD_COPY.currency_rate;
    const rateE4 = typeof body.rate === 'string' ? parseRateToE4(body.rate) : null;
    if (rateE4 === null) errors.rate = FIELD_COPY.rate;
    let effectiveAt = arrival;
    if (body.effective_at !== undefined && body.effective_at !== null) {
      const parsed = new Date(String(body.effective_at));
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() < arrival.getTime() - 1000)
        errors.effective_at = FIELD_COPY.effective_at;
      else effectiveAt = parsed;
    }
    check(errors);
    await insertRate(currency as CurrencyCode, rateE4 as bigint, effectiveAt);
    sendJson(ctx, 201, {
      currency,
      rate: formatRate(rateE4 as bigint),
      effective_at: effectiveAt.toISOString(),
    });
  }),

  route('PATCH', '/api/studio/services/:code', async (ctx) => {
    await requireStudioSession(ctx);
    const body = await readJson(ctx);
    const errors: Record<string, string> = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > 60)
        errors.title = FIELD_COPY.service_title;
    }
    if (body.list_price_pence !== undefined) {
      const price = body.list_price_pence;
      if (
        typeof price !== 'number' ||
        !Number.isInteger(price) ||
        price < 1 ||
        price > 10_000_000
      )
        errors.list_price_pence = FIELD_COPY.list_price_pence;
    }
    check(errors);
    const recordId = await findRecordId('services', 'code', ctx.params.code);
    if (recordId === null) fail('not_found');
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = (body.title as string).trim();
    if (body.list_price_pence !== undefined) patch.list_price_pence = body.list_price_pence;
    await updateRecord('services', recordId as string, patch);
    const services = await servicesForRead();
    const service = services.find((entry) => entry.code === ctx.params.code);
    if (service === undefined) fail('not_found');
    void reindexFromPocketBase().catch(() => undefined);
    sendJson(ctx, 200, service);
  }),

  route('GET', '/api/studio/work', async (ctx) => {
    await requireStudioSession(ctx);
    const content = await studioContent();
    sendJson(ctx, 200, { case_studies: content.allCaseStudies });
  }),

  route('POST', '/api/studio/work', async (ctx) => {
    await requireStudioSession(ctx);
    const body = await readJson(ctx);
    const fields = caseStudyFields(body, false);
    if ((await findRecordId('case_studies', 'slug', fields.slug as string)) !== null)
      fail('slug_taken');
    await createRecord('case_studies', {
      slug: fields.slug,
      title: fields.title,
      client: fields.client,
      summary: fields.summary,
      primitives: fields.scene?.primitives ?? [],
      accent: fields.scene?.accent ?? 'ember',
      published: fields.published ?? false,
      sort: fields.sort ?? 0,
    });
    const content = await studioContent();
    const created = content.allCaseStudies.find((study) => study.slug === fields.slug);
    void reindexFromPocketBase().catch(() => undefined);
    sendJson(ctx, 201, created);
  }),

  route('PATCH', '/api/studio/work/:slug', async (ctx) => {
    await requireStudioSession(ctx);
    const body = await readJson(ctx);
    const recordId = await findRecordId('case_studies', 'slug', ctx.params.slug);
    if (recordId === null) fail('not_found');
    const fields = caseStudyFields({ ...body, slug: undefined }, true);
    const patch: Record<string, unknown> = {};
    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.client !== undefined) patch.client = fields.client;
    if (fields.summary !== undefined) patch.summary = fields.summary;
    if (fields.scene !== undefined) {
      patch.primitives = fields.scene.primitives;
      patch.accent = fields.scene.accent;
    }
    if (fields.published !== undefined) patch.published = fields.published;
    if (fields.sort !== undefined) patch.sort = fields.sort;
    await updateRecord('case_studies', recordId as string, patch);
    const content = await studioContent();
    const updated = content.allCaseStudies.find((study) => study.slug === ctx.params.slug);
    if (updated === undefined) fail('not_found');
    void reindexFromPocketBase().catch(() => undefined);
    sendJson(ctx, 200, updated);
  }),
];
