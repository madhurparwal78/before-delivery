import { hashBody } from '../domain/ids.js';
import { pool } from '../data/db.js';
import {
  claimIdempotency,
  releaseIdempotency,
  storeIdempotency,
} from '../data/idempotency.js';
import { findCampaign, type CampaignRow } from '../data/campaigns.js';
import type { PersonRow } from '../data/people.js';
import { ApiError, conflict, invalid, notFound } from '../http/errors.js';
import { json, type RequestContext, type RouteResult } from '../http/router.js';
import { ServiceDownError } from '../services/health.js';

/** A campaign the caller owns; anyone else's is not found. */
export async function loadOwnCampaign(id: string, creator: PersonRow): Promise<CampaignRow> {
  const campaign = await findCampaign(pool, id);
  if (campaign === null || campaign.creator_id !== creator.id) throw notFound();
  return campaign;
}

export function readIdempotencyKey(ctx: RequestContext): string {
  const header = ctx.headers['idempotency-key'];
  const key = typeof header === 'string' ? header : '';
  if (key.length < 1 || key.length > 64 || /[^\x21-\x7e]/.test(key)) {
    throw invalid({ idempotency_key: 'Send an Idempotency-Key of 1 to 64 visible characters.' });
  }
  return key;
}

/** Maps a dependency outage onto the 503 the API publishes for it. */
export function serviceError(error: unknown): ApiError {
  if (error instanceof ServiceDownError) {
    if (error.service === 'payments') return new ApiError(503, 'payment_unavailable');
    if (error.service === 'storage') return new ApiError(503, 'storage_unavailable');
  }
  return error as ApiError;
}

function withoutKey(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const { key, ...rest } = body as Record<string, unknown>;
  void key;
  return rest;
}

/**
 * Honours an idempotency key: a repeat with an equal body replays the stored answer
 * minus any key field, a different body conflicts, and a 503 is never stored.
 */
export async function withIdempotency(
  scope: string,
  route: string,
  key: string,
  body: unknown,
  run: () => Promise<RouteResult>,
): Promise<RouteResult> {
  const bodyHash = hashBody(body);
  const stored = await claimIdempotency(pool, scope, route, key, bodyHash);
  if (stored !== null) {
    if (stored.body_hash !== bodyHash) throw conflict('idempotency_conflict');
    if (stored.in_progress) throw conflict('idempotency_in_progress');
    return json(stored.status_code as number, withoutKey(stored.response_body));
  }

  try {
    const result = await run();
    if (result.kind === 'json') {
      await storeIdempotency(pool, scope, route, key, result.status, result.body);
    }
    return result;
  } catch (error) {
    const mapped = serviceError(error);
    if (mapped instanceof ApiError && mapped.status !== 503) {
      await storeIdempotency(pool, scope, route, key, mapped.status, mapped.toBody());
    } else {
      await releaseIdempotency(pool, scope, route, key);
    }
    throw mapped;
  }
}
