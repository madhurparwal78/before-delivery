import { Route, jsonBody, pathParam, route } from './router.js';
import { copy, requestLimit, requestSent } from '../copy.js';
import { invalid, notFound, providerUnavailable, rateLimited } from '../errors.js';
import { config } from '../config.js';
import { inTransaction, query } from '../db.js';
import { Ctx, peekJson } from '../http.js';
import { foldEmail, makeReference } from '../../domain/text.js';
import { instantString, ukTimeRoundedUp } from '../../domain/time.js';
import { findAddresses, getAddress } from '../providers/wiremock.js';
import { readEnquiryBody, storeEnquiry } from '../data/enquiries.js';
import { searchPublicPages } from '../render/search.js';
import { requireDesk } from '../session.js';
import { findDeskByEmail } from '../session.js';

async function countRecentRequests(emailFolded: string, now: number): Promise<{ count: number; oldest: number | null }> {
  const since = now - config.enquiryRateWindowSeconds * 1000;
  const rows = await query<{ count: string; oldest: string | null }>(
    'select count(*)::text as count, min(at)::text as oldest from enquiry_rate where email_folded = $1 and at > $2',
    [emailFolded, since],
  );
  return { count: Number(rows[0]?.count ?? 0), oldest: rows[0]?.oldest ? Number(rows[0].oldest) : null };
}

function trapFilled(body: Record<string, unknown> | null): boolean {
  return typeof body?.website === 'string' && body.website.trim() !== '';
}

/** Five accepted requests per folded email per window; the sixth is refused with a UK time. */
async function enquiryRate(ctx: Ctx): Promise<void> {
  const raw = await ctx.body(100_000);
  const body = peekJson(raw, ctx);
  if (!body || trapFilled(body)) return;
  const email = body.email;
  if (typeof email !== 'string' || email.trim() === '') return;
  const now = Date.now();
  const { count, oldest } = await countRecentRequests(foldEmail(email), now);
  if (count < 5 || oldest === null) return;
  const retryAt = oldest + config.enquiryRateWindowSeconds * 1000;
  throw rateLimited(requestLimit(ukTimeRoundedUp(retryAt)), Math.max(1, Math.ceil((retryAt - now) / 1000)));
}

async function makeEnquiry(ctx: Ctx, deskId: string, countsToLimit: boolean): Promise<void> {
  const raw = await ctx.body(100_000);
  const peeked = peekJson(raw, ctx);
  if (trapFilled(peeked)) {
    ctx.json(201, { reference: makeReference(), receivedAt: instantString(Date.now()) });
    return;
  }
  const body = await jsonBody(ctx);
  const now = Date.now();
  const enquiry = readEnquiryBody(body, now);
  const stored = await inTransaction(async (client) =>
    storeEnquiry(client, deskId, enquiry, raw.toString('utf8')),
  );
  if (countsToLimit) {
    await query('insert into enquiry_rate (email_folded, at) values ($1, $2)', [
      foldEmail(enquiry.email),
      stored.receivedAt,
    ]);
  }
  ctx.json(201, { reference: stored.reference, receivedAt: instantString(stored.receivedAt) });
}

export const publicRoutes: Route[] = [
  route('GET', '/api/public/search', 'public', async (ctx) => {
    const q = ctx.cappedQuery('q');
    if (q === null || q.trim() === '') throw invalid(copy.searchTooLong, { q: copy.searchTooLong });
    ctx.json(200, { results: searchPublicPages(q) });
  }),

  route('GET', '/api/public/address/find', 'public', async (ctx) => {
    const q = ctx.cappedQuery('q');
    if (q === null || [...q.trim()].length < 3) {
      throw invalid('Type at least three characters.', { q: 'Type at least three characters.' });
    }
    try {
      ctx.json(200, { suggestions: await findAddresses(q.trim()) });
    } catch {
      throw providerUnavailable(copy.addressFailed, 'addressProviderDown');
    }
  }),

  route('GET', '/api/public/address/get/:id', 'public', async (ctx) => {
    try {
      ctx.json(200, await getAddress(pathParam(ctx, 'id')));
    } catch {
      throw providerUnavailable(copy.addressFailed, 'addressProviderDown');
    }
  }),

  route(
    'POST',
    '/api/public/enquiries',
    'public',
    async (ctx) => {
      const desk = await findDeskByEmail(config.publicDeskEmail);
      if (!desk) throw notFound();
      await makeEnquiry(ctx, desk.id, true);
    },
    { rate: enquiryRate },
  ),

  route('POST', '/api/enquiries', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    await makeEnquiry(ctx, desk.id, false);
  }),
];

export { requestSent };
