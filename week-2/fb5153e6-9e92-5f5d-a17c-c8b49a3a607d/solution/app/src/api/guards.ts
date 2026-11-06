import type { RequestContext } from '../http/router.js';
import { ApiError } from '../http/errors.js';
import type { Role, Session } from '../domain/session.js';

export function requireSession(ctx: RequestContext): Session {
  if (ctx.session === null) throw new ApiError('unauthenticated');
  return ctx.session;
}

/** A signed-in role calling another role's area answers 403 `forbidden`. */
export function requireRole(ctx: RequestContext, ...roles: readonly Role[]): Session {
  const session = requireSession(ctx);
  if (!roles.includes(session.role)) throw new ApiError('forbidden');
  return session;
}

export function requireAuthor(ctx: RequestContext): Session {
  return requireRole(ctx, 'author');
}

/** The studio routes the editor shares with the author. */
export function requireAuthorOrEditor(ctx: RequestContext): Session {
  return requireRole(ctx, 'author', 'editor');
}

export function requireContributor(ctx: RequestContext): Session {
  return requireRole(ctx, 'contributor');
}

export function requireStaff(ctx: RequestContext): Session {
  return requireRole(ctx, 'staff');
}

/** A studio session may fetch media of a model in any state or visibility. */
export function hasStudioSession(ctx: RequestContext): boolean {
  const role = ctx.session?.role;
  return role === 'author' || role === 'editor' || role === 'contributor';
}
