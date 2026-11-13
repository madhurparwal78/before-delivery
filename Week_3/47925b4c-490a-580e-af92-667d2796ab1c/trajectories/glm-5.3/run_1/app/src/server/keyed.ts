// Idempotency plumbing shared by the route modules.

import type { PoolClient } from 'pg';
import { beginIdempotent, finishIdempotent, requestHash } from './idempotency.js';
import { problems } from './api-core.js';
import { RouteError, type Ctx } from './route-context.js';

export interface KeyedOutcome {
  kind: 'fresh' | 'replay' | 'reused';
  status?: number;
  body?: unknown;
}

// Runs inside the caller's transaction; a replay returns before any state check. A key
// claimed by a live actor is retried after a short wait so parallel duplicates receive
// the same outcome.
export async function beginKeyed(ctx: Ctx, client: PoolClient): Promise<KeyedOutcome> {
  if (ctx.idempotencyKey === null) {
    throw new Error('keyed route without a key');
  }
  const scope = `${ctx.method} ${ctx.url.pathname}`;
  const outcome = await beginIdempotent(client, ctx.idempotencyKey, scope, requestHash(keyBody(ctx)));
  if (outcome.kind === 'reused') {
    throw new RouteError(problems.idempotencyKeyReused());
  }
  if (outcome.kind === 'claimed') {
    await sleep(CLAIM_WAIT_MS);
    const retry = await beginIdempotent(client, ctx.idempotencyKey, scope, requestHash(keyBody(ctx)));
    if (retry.kind === 'replay') {
      return { kind: 'replay', status: retry.status, body: retry.body };
    }
    if (retry.kind === 'reused') {
      throw new RouteError(problems.idempotencyKeyReused());
    }
    return { kind: 'fresh' };
  }
  if (outcome.kind === 'replay') {
    return { kind: 'replay', status: outcome.status, body: outcome.body };
  }
  return { kind: 'fresh' };
}

const CLAIM_WAIT_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function finishKeyed(ctx: Ctx, client: PoolClient, status: number, body: unknown): Promise<void> {
  if (ctx.idempotencyKey === null) return;
  const scope = `${ctx.method} ${ctx.url.pathname}`;
  await finishIdempotent(client, ctx.idempotencyKey, scope, status, body);
}

// The request body participates in the key identity; the raw photo hashes its bytes.
function keyBody(ctx: Ctx): unknown {
  if (ctx.rawBody !== null) {
    return { bytes: ctx.rawBody.length };
  }
  return ctx.jsonBody;
}
