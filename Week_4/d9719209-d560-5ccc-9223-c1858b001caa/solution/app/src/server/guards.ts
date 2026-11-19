import type { Db } from './db.js';
import { one } from './db.js';
import { config } from './config.js';
import { AppError, forbidden, unauthenticated } from './errors.js';
import type { Ctx } from './http.js';
import type { SessionUser } from './accounts.js';

/** Error precedence steps 3 and 4: a signed-in, not suspended caller. */
export function requireUser(ctx: Ctx): SessionUser {
  if (ctx.session.suspended) throw new AppError('SUSPENDED', 'This account is suspended');
  if (!ctx.session.user) throw unauthenticated();
  return ctx.session.user;
}

/** Public endpoints treat a suspended or missing session as a visitor. */
export const optionalUser = (ctx: Ctx): SessionUser | null => ctx.session.user;

export function requireVerified(user: SessionUser): void {
  if (!user.emailVerified) throw new AppError('EMAIL_UNVERIFIED', 'Verify your email to do this');
}

export const totpRequired = (): AppError => new AppError('TOTP_REQUIRED', 'Turn on two-factor authentication to continue');

/** The two-factor requirement: site admins, and moderators of a community above the member threshold. */
export function assertTotp(user: SessionUser, scope: { admin: true } | { memberCount: number }): void {
  const needed = 'admin' in scope ? true : scope.memberCount > config.limits.mod2faMemberThreshold;
  if (needed && !user.totpEnabled) throw totpRequired();
}

export async function isModerator(db: Db, communityId: string, userId: string): Promise<boolean> {
  return (await one(db, 'SELECT 1 FROM moderators WHERE community_id = $1 AND user_id = $2', [communityId, userId])) !== null;
}

export async function requireModerator(db: Db, user: SessionUser, community: { id: string; memberCount: number }): Promise<void> {
  if (!(await isModerator(db, community.id, user.id))) throw forbidden('Only moderators can do this');
  assertTotp(user, { memberCount: community.memberCount });
}

export function requireAdmin(user: SessionUser): void {
  if (user.role !== 'admin') throw forbidden('Only site admins can do this');
  assertTotp(user, { admin: true });
}
