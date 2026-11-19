import { ApiError } from './http/errors.js';
import { keyRateFor } from './billing.js';
import { takeToken } from './providers/valkey.js';
import type { Actor } from './auth.js';

/** Each API key is limited to its builder's effective plan rate, held in Valkey. */
export async function enforceRateLimit(actor: Actor): Promise<void> {
  const keyId = actor.apiKeyId;
  if (keyId === null) return;
  const decision = await takeToken(keyId, await keyRateFor(actor.member.id));
  if (decision.allowed) return;
  throw new ApiError(429, 'rate_limited', { retry_after_ms: decision.retryAfterMs }, {
    'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)),
  });
}
