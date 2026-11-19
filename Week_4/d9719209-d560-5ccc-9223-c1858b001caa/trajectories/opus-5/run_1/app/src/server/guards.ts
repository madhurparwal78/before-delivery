import { config } from '../core/config.js';
import { db } from '../core/db.js';
import { ApiError, errors } from '../core/errors.js';
import { consumeRate, ValkeyUnavailable } from '../services/valkey.js';
import { copy } from '../shared/copy.js';
import { loadCommunity, requiresTwoFactor, type Community } from '../domain/communities.js';
import { moderates, type Member } from '../domain/viewer.js';
import { requireMember, type Ctx } from './http.js';

export async function communityOr404(name: string): Promise<Community> {
  const community = await loadCommunity(db, name);
  if (!community) throw errors.notFound('Community not found');
  return community;
}

/** Only moderators may use moderator endpoints, and two-factor is checked after the role. */
export function requireModerator(ctx: Ctx, community: Community): Member {
  const member = requireMember(ctx);
  if (!moderates(ctx.viewer, String(community.id))) throw errors.forbidden('You are not a moderator here');
  if (requiresTwoFactor(community) && !member.totpEnabled) {
    throw new ApiError('TOTP_REQUIRED', 'Turn on two-factor authentication to use moderator tools', { status: 403 });
  }
  return member;
}

export function requireAdmin(ctx: Ctx): Member {
  const member = requireMember(ctx);
  if (member.role !== 'admin') throw errors.forbidden('Only site admins can do that');
  if (!member.totpEnabled) {
    throw new ApiError('TOTP_REQUIRED', 'Turn on two-factor authentication to use admin tools', { status: 403 });
  }
  return member;
}

/** Posts and comments share one rolling counter; without Valkey the limit is skipped. */
export async function checkPostingRate(member: Member): Promise<void> {
  try {
    const decision = await consumeRate('post', member.id, config.limits.postRateLimit);
    if (!decision.allowed) {
      throw errors.rateLimited(copy.vote.rateLimited(decision.retryAfter), decision.retryAfter);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ValkeyUnavailable) return;
    throw error;
  }
}

export function idempotencyKey(ctx: Ctx): string | null {
  const header = ctx.req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value === '') return null;
  return value.length <= 100 && /^[\x20-\x7e]+$/.test(value) ? value : null;
}
