import { one, pool } from './db'
import { tierFor } from './loyalty'
import { preferences, setCookie, token, type Identity, type Preferences } from './auth'
import { ensureVisitor, type Ctx } from './http'

/** The `account.changed` payload; language and currency are null when only the tier moved so that tabs keep their own. */
export async function accountPayload(userId: number | null, now: Date, signedOut: boolean, prefs: Preferences | null = null): Promise<Record<string, unknown>> {
  const tier = await tierFor(pool, userId, now)
  return { lang: prefs?.lang ?? null, cur: prefs?.cur ?? null, tier: tier.name, completed_stays: tier.completed, signed_out: signedOut }
}

export async function meView(identity: Identity, now: Date) {
  const prefs = await preferences(identity)
  const tier = await tierFor(pool, identity.user?.id ?? null, now)
  return {
    user: identity.user ? { username: identity.user.username, role: identity.user.role, manages: identity.user.manages } : null,
    lang: prefs.lang, cur: prefs.cur, tier: tier.name, completed_stays: tier.completed, perks: tier.perks,
  }
}

/** Opens a session for a user, carrying over the visitor's language and currency, and sets its cookie. */
export async function startSession(ctx: Ctx, userId: number): Promise<void> {
  const visitor = ensureVisitor(ctx)
  const prefs = await one<{ lang: string; cur: string }>(pool, `SELECT lang, cur FROM visitors WHERE id = $1`, [visitor])
  const id = token(24)
  await pool.query(`INSERT INTO sessions (id, user_id, lang, cur) VALUES ($1,$2,$3,$4)`, [id, userId, prefs?.lang ?? 'en', prefs?.cur ?? 'EUR'])
  setCookie(ctx.res, 'kip_session', id)
  ctx.identity.session = id
}
