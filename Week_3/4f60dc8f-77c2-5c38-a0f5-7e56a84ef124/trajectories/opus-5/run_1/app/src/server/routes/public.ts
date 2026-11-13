import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { FIELD_COPY } from '../../shared/errors.js';
import { ACCOUNT_CURRENCIES, isCurrencyCode, type CurrencyCode } from '../../shared/money.js';
import { fail } from '../http/app-error.js';
import {
  appendSetCookie,
  readCookies,
  readJson,
  route,
  sendJson,
  sendNoContent,
  setCookie,
  type Route,
} from '../http/kernel.js';
import {
  findBrand,
  consumeCode,
  countCodeRequestAges,
  createBrandWithEngagement,
  createSession,
  deleteSession,
  emailTaken,
  findContactByEmail,
  issueSigninCode,
  liveSigninCode,
  recordCodeFailure,
  recordCodeRequest,
} from '../db/brands.js';
import { enqueue } from '../db/outbox.js';
import { transaction } from '../db/pool.js';
import { listRates } from '../db/fx.js';
import { findEngagement } from '../db/engagements.js';
import { judgeCodeWindow } from '../domain/signin.js';
import { landingPath } from '../domain/landing.js';
import { boundedText, check, isEmail, type FieldErrors } from '../app/validate.js';
import { studioContent, publicCaseStudy, servicesForRead } from '../app/content.js';
import { statusView } from '../app/status.js';
import { search } from '../services/search.js';
import { kickOutbox } from '../app/outbox-worker.js';
import { CLIENT_COOKIE } from '../app/auth.js';
import { engagementView, loadEngagementBundle } from '../serialise.js';

const startFormErrors = (body: Record<string, unknown>): FieldErrors => {
  const errors: FieldErrors = {};
  if (!boundedText(body.brand_name, 1, 80)) errors.brand_name = FIELD_COPY.brand_name;
  if (!boundedText(body.contact_name, 1, 80)) errors.contact_name = FIELD_COPY.contact_name;
  if (!boundedText(body.title, 1, 120)) errors.title = FIELD_COPY.title;
  if (!isEmail(body.email)) errors.email = FIELD_COPY.email;
  if (body.finance_email !== undefined && body.finance_email !== null && !isEmail(body.finance_email))
    errors.finance_email = FIELD_COPY.email;
  if (!isEmail(body.reviewer_email)) errors.reviewer_email = FIELD_COPY.email;
  if (!isCurrencyCode(body.currency) || !ACCOUNT_CURRENCIES.includes(body.currency))
    errors.currency = FIELD_COPY.currency_start;
  return errors;
};

export const publicRoutes: Route[] = [
  route('GET', '/api/health', async (ctx) => {
    sendJson(ctx, 200, { status: 'ok' });
  }),

  route('GET', '/api/status', async (ctx) => {
    sendJson(ctx, 200, await statusView());
  }),

  route('GET', '/api/content', async (ctx) => {
    const content = await studioContent();
    sendJson(ctx, 200, {
      case_studies: content.case_studies,
      services: content.services,
      team: content.team,
      insights: content.insights,
      marquee: content.marquee,
    });
  }),

  route('GET', '/api/work/:slug', async (ctx) => {
    const study = await publicCaseStudy(ctx.params.slug);
    if (study === null) fail('not_found');
    sendJson(ctx, 200, study);
  }),

  route('GET', '/api/search', async (ctx) => {
    const raw = ctx.url.searchParams.get('q') ?? '';
    const trimmed = raw.trim();
    if (trimmed.length > 100) check({ q: FIELD_COPY.q });
    sendJson(ctx, 200, { query: trimmed, hits: await search(trimmed) });
  }),

  route('POST', '/api/projects/start', async (ctx) => {
    const body = await readJson(ctx);
    const emails = [body.email, body.finance_email, body.reviewer_email].filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    );
    if (emails.length > 0 && (await emailTaken(emails))) fail('email_taken');
    check(startFormErrors(body));

    const email = (body.email as string).trim();
    const created = await createBrandWithEngagement({
      name: (body.brand_name as string).trim(),
      currency: body.currency as CurrencyCode,
      owner: { name: (body.contact_name as string).trim(), email },
      financeEmail:
        typeof body.finance_email === 'string' && body.finance_email.trim() !== ''
          ? body.finance_email.trim()
          : email,
      reviewerEmail: (body.reviewer_email as string).trim(),
      engagementTitle: (body.title as string).trim(),
    });

    const token = await createSession('client', created.owner.id, created.brand.id);
    appendSetCookie(ctx, setCookie(CLIENT_COOKIE, token));

    const engagement = await findEngagement(created.engagementId);
    const bundle = await loadEngagementBundle(
      engagement as NonNullable<typeof engagement>,
      await servicesForRead(),
      await listRates(),
    );
    sendJson(ctx, 201, { engagement: engagementView(bundle, 'client') });
  }),

  route('POST', '/api/session/code', async (ctx) => {
    const body = await readJson(ctx);
    if (!isEmail(body.email)) check({ email: FIELD_COPY.email });
    const email = (body.email as string).trim();

    const ages = await countCodeRequestAges(email, config.signinCodeWindowSeconds);
    const decision = judgeCodeWindow(ages, config.signinCodeWindowSeconds);
    if (!decision.allowed)
      fail('too_many_requests', { headers: { 'Retry-After': String(decision.retryAfterSeconds) } });

    await recordCodeRequest(email);
    const contact = await findContactByEmail(email);
    if (contact !== null) {
      const code = await issueSigninCode(contact.id);
      await transaction(async (client) => {
        await enqueue(
          client,
          'signin_code_email',
          { email: contact.email, code },
          `signin_code:${randomUUID()}`,
        );
      });
      kickOutbox();
    }
    sendJson(ctx, 202, { status: 'sent' });
  }),

  route('POST', '/api/session', async (ctx) => {
    const body = await readJson(ctx);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const submitted = typeof body.code === 'string' ? body.code.trim() : '';
    const contact = await findContactByEmail(email);
    if (contact === null) fail('code_invalid');
    const row = contact;
    const live = await liveSigninCode(row.id);
    if (live === null || live.used || live.age > config.signinCodeTtlSeconds) fail('code_invalid');
    if (live.code !== submitted) {
      await recordCodeFailure(live.id);
      fail('code_invalid');
    }
    await consumeCode(live.id);

    const token = await createSession('client', row.id, row.brand_id);
    appendSetCookie(ctx, setCookie(CLIENT_COOKIE, token));
    const brand = await findBrand(row.brand_id);
    sendJson(ctx, 200, {
      brand: {
        id: row.brand_id,
        name: brand?.name ?? '',
        currency: brand?.currency ?? 'GBP',
      },
      contact: { name: row.name, email: row.email },
      landing: landingPath(body.next),
    });
  }),

  route('DELETE', '/api/session', async (ctx) => {
    const token = readCookies(ctx)[CLIENT_COOKIE];
    if (token !== undefined) await deleteSession(token);
    sendNoContent(ctx);
  }),
];
