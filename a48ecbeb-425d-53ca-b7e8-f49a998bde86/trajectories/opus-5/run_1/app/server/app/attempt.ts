import { apiMessages } from '../../shared/copy.js';
import {
  abandonAttempt,
  claimAttempt,
  finishAttempt,
  hashBody,
  readFinishedAttempt,
  type AttemptScope,
} from '../db/attempts.js';
import { ApiError, conflict, storeUnavailable, validationError } from '../http/errors.js';
import type { Reply } from '../http/router.js';

const WAIT_LIMIT_MS = 30_000;
const WAIT_STEP_MS = 250;

export function readAttemptKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header[0] : header;
  if (key === undefined || key.length < 8 || key.length > 128) {
    throw validationError({ idempotency_key: apiMessages.idempotencyKeyRequired });
  }
  return key;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs an attempt once per key. A replay with the same body returns the stored
 * response and makes no new charge, order, PDF or email; a replay with another
 * body is refused. A 503 is never stored, so a retry after the service returns
 * completes the attempt.
 */
export async function runOncePerKey(
  scope: AttemptScope,
  userId: string,
  key: string,
  body: unknown,
  work: () => Promise<Reply>,
): Promise<Reply> {
  const bodyHash = hashBody(body ?? null);
  const claim = await claimAttempt(scope, userId, key, bodyHash);

  if (claim.outcome === 'mismatch') {
    throw conflict('idempotency_mismatch', apiMessages.idempotencyMismatch);
  }
  if (claim.outcome === 'stored') {
    return { status: claim.stored.status, json: claim.stored.body };
  }
  if (claim.outcome === 'running') {
    const deadline = Date.now() + WAIT_LIMIT_MS;
    while (Date.now() < deadline) {
      await sleep(WAIT_STEP_MS);
      const stored = await readFinishedAttempt(scope, userId, key);
      if (stored !== null) return { status: stored.status, json: stored.body };
    }
    throw storeUnavailable();
  }

  try {
    const reply = await work();
    await finishAttempt(scope, userId, key, { status: reply.status, body: reply.json ?? null });
    return reply;
  } catch (error) {
    if (error instanceof ApiError && error.status !== 503) {
      await finishAttempt(scope, userId, key, { status: error.status, body: error.body() });
      throw error;
    }
    await abandonAttempt(scope, userId, key);
    throw error;
  }
}
