import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { UserJson } from '../shared/domain.ts'
import { formatBusinessTime } from '../shared/time.ts'
import { config } from './config.ts'
import { exactlyOne, one, query, transaction } from './db.ts'
import { FIELD, invalid, mailUnavailable, signedOut } from './errors.ts'
import { cookieValue, jsonBody, route, sessionCookie, SESSION_COOKIE, SESSION_DAYS, type Context, type Route } from './http.ts'
import { sendSignInCode } from './mail.ts'

const MAX_ATTEMPTS = 5
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value)
}

export function validDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 40
}

interface UserRow {
  id: string
  email: string
  display_name: string
}

const toUser = (row: UserRow): UserJson => ({ id: row.id, email: row.email, displayName: row.display_name })

async function userBySession(token: string | null): Promise<UserJson | null> {
  if (!token) return null
  const row = await one<UserRow>(
    `SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [digest(token)],
  )
  return row ? toUser(row) : null
}

export async function currentUser(context: Pick<Context, 'req'>): Promise<UserJson | null> {
  return userBySession(cookieValue(context.req, SESSION_COOKIE))
}

export async function requireUser(context: Pick<Context, 'req'>): Promise<UserJson> {
  const user = await currentUser(context)
  if (!user) throw signedOut()
  return user
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval \'1 day\')', [digest(token), userId, SESSION_DAYS])
  return token
}

export async function upsertUser(email: string, displayName: string): Promise<UserJson> {
  return toUser(await exactlyOne<UserRow>(
    `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id, email, display_name`,
    [randomUUID(), email, displayName.trim()],
  ))
}

async function requestCode(context: Context) {
  const body = jsonBody(context)
  const fields: Record<string, string> = {}
  if (!validEmail(body.email)) fields.email = FIELD.email
  const existing = validEmail(body.email) ? await one<UserRow>('SELECT id, email, display_name FROM users WHERE email = $1', [body.email]) : undefined
  if (!existing && !validDisplayName(body.displayName)) fields.displayName = FIELD.displayName
  if (Object.keys(fields).length) throw invalid(fields)
  const email = body.email as string
  const displayName = existing?.display_name ?? (body.displayName as string).trim()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const expiresAt = new Date(Date.now() + config.codeTtlSeconds * 1000)
  await query(
    `INSERT INTO sign_in_codes (email, display_name, code_hash, attempts, expires_at) VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (email) DO UPDATE SET display_name = $2, code_hash = $3, attempts = 0, expires_at = $4`,
    [email, displayName, digest(`${email}:${code}`), expiresAt],
  )
  try {
    await sendSignInCode(email, code, formatBusinessTime(expiresAt.toISOString(), config.timeZone))
  } catch {
    await query('DELETE FROM sign_in_codes WHERE email = $1', [email])
    throw mailUnavailable()
  }
  return { status: 202, body: { status: 'sent' } }
}

async function openSession(context: Context) {
  const body = jsonBody(context)
  const fields: Record<string, string> = {}
  if (!validEmail(body.email)) fields.email = FIELD.email
  if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) fields.code = FIELD.code
  if (Object.keys(fields).length) throw invalid(fields)
  const email = body.email as string
  const code = body.code as string
  const user = await transaction(async (db) => {
    const row = await one<{ display_name: string; code_hash: string; attempts: number; expires_at: Date }>(
      'SELECT display_name, code_hash, attempts, expires_at FROM sign_in_codes WHERE email = $1 FOR UPDATE',
      [email],
      db,
    )
    if (!row || row.expires_at.getTime() <= Date.now() || row.attempts >= MAX_ATTEMPTS) return null
    if (row.code_hash !== digest(`${email}:${code}`)) {
      await query('UPDATE sign_in_codes SET attempts = attempts + 1 WHERE email = $1', [email], db)
      return null
    }
    await query('DELETE FROM sign_in_codes WHERE email = $1', [email], db)
    return row.display_name
  })
  if (user === null) throw invalid({ code: FIELD.code })
  const signedIn = await upsertUser(email, user)
  const token = await createSession(signedIn.id)
  return { status: 200, body: { user: signedIn }, headers: { 'Set-Cookie': sessionCookie(token) } }
}

export const routes: Route[] = [
  route('POST', '/api/auth/code', requestCode),
  route('POST', '/api/auth/session', openSession),
  route('DELETE', '/api/auth/session', async (context) => {
    const token = cookieValue(context.req, SESSION_COOKIE)
    if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)])
    return { status: 204, headers: { 'Set-Cookie': sessionCookie(null) } }
  }),
  route('GET', '/api/me', async (context) => ({ status: 200, body: { user: await requireUser(context) } })),
]
