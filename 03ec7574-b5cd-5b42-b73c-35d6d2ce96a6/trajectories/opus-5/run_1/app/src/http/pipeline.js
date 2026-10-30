import { ROLE_GATES, resolvePrincipal } from './auth.js';
import { ApiError } from './errors.js';
import { beginIdempotent, bodyDigest, keepIdempotent, readIdempotencyKey, releaseIdempotent } from './idempotency.js';
import { errorHead, successHead, toApiError } from './respond.js';

const KEPT_REFUSALS = new Set(['POLICY_DENIED']);

/** Builds the caller context after the app id, credential, app id match and role steps. */
export async function authenticate({ route, headers, bearer }) {
  if (route.auth === 'none') return null;
  if (route.org !== false && !headers['x-corvo-org']) throw new ApiError('APP_ID_REQUIRED');
  if (!bearer) throw new ApiError('UNAUTHENTICATED');
  const principal = await resolvePrincipal(bearer);
  if (!principal) throw new ApiError('INVALID_CREDENTIAL');
  if (headers['x-corvo-org'] !== principal.organization.app_id) throw new ApiError('APP_ID_MISMATCH');
  const gate = ROLE_GATES[route.role || 'readers'];
  if (!gate(principal)) throw new ApiError('FORBIDDEN_ROLE');
  return principal;
}

export async function runApiRoute({ route, ctx, rawBody }) {
  if (!route.idempotent) {
    const result = await route.handler(ctx);
    return finish(result);
  }

  const key = readIdempotencyKey(ctx.headers);
  if (!key) {
    const result = await route.handler(ctx);
    return finish(result);
  }

  const organizationId = ctx.organization.id;
  const binding = { organizationId, key, method: ctx.method, path: ctx.path, digest: bodyDigest(rawBody) };
  const begun = await beginIdempotent(binding);
  if (begun.mode === 'replay') {
    return { status: begun.status, head: begun.head, headers: { 'Idempotent-Replayed': 'true' } };
  }

  try {
    const result = await route.handler(ctx);
    const answer = finish(result);
    await keepIdempotent({ organizationId, key, status: answer.status, head: answer.head });
    return answer;
  } catch (error) {
    const apiError = toApiError(error);
    if (KEPT_REFUSALS.has(apiError.code)) {
      const head = errorHead(apiError);
      await keepIdempotent({ organizationId, key, status: apiError.status, head });
      return { status: apiError.status, head };
    }
    await releaseIdempotent({ organizationId, key });
    throw error;
  }
}

function finish(result) {
  if (result.csv !== undefined) return { status: result.status, csv: result.csv };
  return { status: result.status, head: successHead(result.data) };
}
