import { pipeline } from 'node:stream/promises';
import { fail } from '../http/app-error.js';
import { idempotencyKey, readJson, route, sendJson, type Route } from '../http/kernel.js';
import { claimIdempotency, settleClaim } from '../db/idempotency.js';
import { findStill } from '../db/engagements.js';
import {
  buildReviewView,
  resolveReviewToken,
  reviewerAccept,
  reviewerRevision,
} from '../app/review.js';
import { kickOutbox } from '../app/outbox-worker.js';
import { getObjectStream, headObject } from '../services/storage.js';

export const REVIEW_HEADERS = { 'Referrer-Policy': 'no-referrer' } as const;

export const reviewRoutes: Route[] = [
  route('GET', '/api/review/:token', async (ctx) => {
    const resolved = await resolveReviewToken(ctx.params.token);
    sendJson(ctx, 200, await buildReviewView(resolved), REVIEW_HEADERS);
  }),

  route('GET', '/api/review/:token/stills/:still_id', async (ctx) => {
    const resolved = await resolveReviewToken(ctx.params.token);
    const still = await findStill(ctx.params.still_id);
    if (
      still === null ||
      still.engagement_id !== resolved.engagement.id ||
      still.milestone !== resolved.link.milestone
    )
      fail('not_found');
    const row = still as NonNullable<typeof still>;
    const stored = await headObject(row.object_key);
    if (stored === null) fail('not_found');
    const body = await getObjectStream(row.object_key);
    ctx.response.writeHead(200, {
      'Content-Type': row.content_type,
      'Content-Length': (stored as NonNullable<typeof stored>).size,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...REVIEW_HEADERS,
    });
    await pipeline(body, ctx.response);
  }),

  route('POST', '/api/review/:token/accept', async (ctx) => {
    const resolved = await resolveReviewToken(ctx.params.token);
    const review = await reviewerAccept(resolved);
    kickOutbox();
    sendJson(ctx, 200, review, REVIEW_HEADERS);
  }),

  route('POST', '/api/review/:token/revisions', async (ctx) => {
    const resolved = await resolveReviewToken(ctx.params.token);
    const key = idempotencyKey(ctx);
    const body = await readJson(ctx);
    const scope = `revision:${resolved.engagement.id}`;
    const claim = await claimIdempotency(scope, key, body);
    if (claim.kind === 'stored') {
      sendJson(ctx, claim.outcome.status, claim.outcome.body, REVIEW_HEADERS);
      return;
    }
    const outcome = await settleClaim(scope, key, async () => ({
      status: 201,
      body: await reviewerRevision(resolved, body.note),
    }));
    kickOutbox();
    sendJson(ctx, outcome.status, outcome.body, REVIEW_HEADERS);
  }),
];
