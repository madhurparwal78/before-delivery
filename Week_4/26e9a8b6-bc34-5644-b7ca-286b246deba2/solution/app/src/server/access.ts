import { pool } from './db';
import { forbidden, notFound, notSignedIn, unconfirmed, withdrawn } from './errors';
import type { Ctx } from './http';
import { guideById, isMember, roleOf, visibleTo, type GuideRecord, type Role } from './content';
import type { User } from '../shared/types';

interface Need {
  session?: boolean;
  role?: 'any' | 'member' | 'owner';
  confirmed?: boolean;
}

interface GuideAccess { guide: GuideRecord; role: Role }

export function requireUser(ctx: Ctx, confirmed = false): User {
  if (!ctx.user) throw notSignedIn();
  if (confirmed && !ctx.user.confirmed) throw unconfirmed();
  return ctx.user;
}

/** The one error precedence for a route that names a guide: 404, 401, 410, 403 forbidden, 403 unconfirmed. */
export async function guideAccess(ctx: Ctx, id: string, need: Need = {}): Promise<GuideAccess> {
  const guide = await guideById(pool, id);
  const role = guide ? await roleOf(pool, guide, ctx.user) : 'none';
  if (!guide || !visibleTo(guide, role)) throw notFound();
  if (need.session && !ctx.user) throw notSignedIn();
  if (guide.state === 'withdrawn' && !isMember(role)) throw withdrawn();
  if ((need.role === 'member' && !isMember(role)) || (need.role === 'owner' && role !== 'owner')) throw forbidden();
  if (need.confirmed && !ctx.user?.confirmed) throw unconfirmed();
  return { guide, role };
}
