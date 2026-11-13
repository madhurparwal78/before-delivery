import { clearedCookie, checkPassword, cookieOf, closeSession, hashPassword, newToken, openSession, SESSION_COOKIE, sessionCookie } from '../auth.ts'
import { config } from '../config.ts'
import { one, pool, transaction } from '../db.ts'
import { type Ctx, HttpError, conflict, invalid, notFound, route } from '../http.ts'
import { MailUnavailable, sendMail } from '../mail.ts'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAIL_FAILED = 'The mail could not be sent. Try again.'
export const mailUnavailable = () => new HttpError(503, { error: 'mail_unavailable', message: MAIL_FAILED })

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function checkName(value: unknown): string {
  const name = text(value).trim()
  if (!name) throw invalid('name', 'Enter your name.')
  return name
}

export function checkEmail(value: unknown): string {
  const email = text(value).trim().toLowerCase()
  if (!EMAIL.test(email)) throw invalid('email', 'Enter a valid email address.')
  return email
}

export function checkPasswordLength(field: string, value: unknown): string {
  const password = text(value)
  if (password.length < 10) throw invalid(field, 'A password needs at least 10 characters.')
  return password
}

function profile(user: { id: string; name: string; email: string; reduceMotion: boolean }) {
  return { id: user.id, name: user.name, email: user.email, reduceMotion: user.reduceMotion }
}

route('POST', '/api/signup', 'public', async (ctx) => {
  const body = object(ctx.body())
  const name = checkName(body.name)
  const email = checkEmail(body.email)
  const password = checkPasswordLength('password', body.password)
  const id = await transaction(async (db) => {
    const existing = await one<{ id: string; verified: boolean }>(db, 'SELECT id, verified FROM users WHERE email = $1 FOR UPDATE', [email])
    if (existing?.verified) throw conflict('email_taken', 'That email already has an account.')
    const hash = await hashPassword(password)
    const userId = existing
      ? (await db.query('UPDATE users SET name = $2, password_hash = $3 WHERE id = $1 RETURNING id', [existing.id, name, hash])).rows[0].id as string
      : (await db.query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id', [email, name, hash])).rows[0]?.id as string | undefined
    if (!userId) throw conflict('email_taken', 'That email already has an account.')
    const token = newToken()
    await db.query('DELETE FROM verify_tokens WHERE user_id = $1', [userId])
    await db.query('INSERT INTO verify_tokens (token, user_id) VALUES ($1, $2)', [token, userId])
    try {
      await sendMail(email, 'Verify your Twinrow email',
        `Welcome to Twinrow, ${name}.\n\nVerify your email address with this link:\n${config.publicUrl}/verify?token=${token}\n`)
    } catch (error) {
      if (error instanceof MailUnavailable) throw mailUnavailable()
      throw error
    }
    return userId
  })
  ctx.reply(201, { id })
})

route('POST', '/api/verify', 'public', async (ctx) => {
  const token = text(object(ctx.body()).token)
  const found = await one<{ user_id: string; expired: boolean }>(pool,
    `SELECT user_id, created_at < now() - ($2 || ' hours')::interval AS expired FROM verify_tokens WHERE token = $1`,
    [token, String(config.limits.verifyTtlHours)])
  if (!found) throw notFound()
  if (found.expired) throw conflict('link_expired', 'This link has expired. Sign up again to get a new one.')
  await pool.query('UPDATE users SET verified = true WHERE id = $1', [found.user_id])
  ctx.reply(200, { verified: true })
})

route('POST', '/api/session', 'public', async (ctx) => {
  const body = object(ctx.body())
  const found = await one<{ id: string; name: string; email: string; password_hash: string; verified: boolean; reduce_motion: boolean }>(pool,
    'SELECT id, name, email, password_hash, verified, reduce_motion FROM users WHERE email = $1', [text(body.email).trim().toLowerCase()])
  const password = text(body.password)
  if (!found || !(await checkPassword(password, found.password_hash))) {
    throw new HttpError(401, { error: 'invalid_credentials', message: 'Email or password is incorrect.' })
  }
  if (!found.verified) throw new HttpError(401, { error: 'unverified', message: 'Verify your email first.' })
  const token = await openSession(found.id)
  ctx.reply(200, { id: found.id, name: found.name, email: found.email }, { 'Set-Cookie': sessionCookie(token) })
})

route('DELETE', '/api/session', 'public', async (ctx) => {
  const token = cookieOf(ctx.req, SESSION_COOKIE)
  if (token) await closeSession(token)
  ctx.reply(204, undefined, { 'Set-Cookie': clearedCookie })
})

route('GET', '/api/me', 'user', (ctx) => ctx.reply(200, profile(ctx.user)))

route('PATCH', '/api/me', 'user', async (ctx) => {
  const body = object(ctx.body())
  const name = body.name === undefined ? ctx.user.name : checkName(body.name)
  if (body.reduceMotion !== undefined && typeof body.reduceMotion !== 'boolean') throw invalid('reduceMotion', 'Reduce motion is on or off.')
  const reduceMotion = body.reduceMotion === undefined ? ctx.user.reduceMotion : body.reduceMotion
  await pool.query('UPDATE users SET name = $2, reduce_motion = $3 WHERE id = $1', [ctx.user.id, name, reduceMotion])
  ctx.reply(200, profile({ ...ctx.user, name, reduceMotion }))
})

route('POST', '/api/me/password', 'user', async (ctx: Ctx) => {
  const body = object(ctx.body())
  const stored = await one<{ password_hash: string }>(pool, 'SELECT password_hash FROM users WHERE id = $1', [ctx.user.id])
  if (!(await checkPassword(text(body.current), stored!.password_hash))) throw invalid('current', 'That password is not right.')
  const next = checkPasswordLength('next', body.next)
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [ctx.user.id, await hashPassword(next)])
  ctx.reply(204)
})
