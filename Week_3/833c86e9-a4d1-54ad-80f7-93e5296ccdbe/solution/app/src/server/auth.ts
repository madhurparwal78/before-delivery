import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CURRENCIES, LANGS, type Currency, type Lang } from '../shared/i18n'
import { one, pool, rows } from './db'

export interface Identity {
  visitor: string | null
  session: string | null
  user: { id: number; username: string; role: 'guest' | 'manager' | 'operator'; manages: string[] } | null
}

export const token = (bytes = 16): string => randomBytes(bytes).toString('hex')

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(password, salt, 32).toString('hex')}`
}

export function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  const candidate = scryptSync(password, Buffer.from(salt, 'hex'), 32)
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'))
}

function cookiesOf(req: IncomingMessage): Record<string, string> {
  const found: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index > 0) found[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return found
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAgeSeconds = 31536000): void {
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  const existing = res.getHeader('set-cookie')
  res.setHeader('set-cookie', [...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []), cookie])
}

export async function identify(req: IncomingMessage): Promise<Identity> {
  const cookies = cookiesOf(req)
  const visitor = cookies.kip_visitor && /^[0-9a-f]{32}$/.test(cookies.kip_visitor) ? cookies.kip_visitor : null
  let user: Identity['user'] = null
  let session: string | null = null
  if (cookies.kip_session) {
    const row = await one<{ id: number; username: string; role: 'guest' | 'manager' | 'operator' }>(
      pool,
      `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
      [cookies.kip_session],
    )
    if (row) {
      session = cookies.kip_session
      const manages = await rows<{ property: string }>(pool, `SELECT property FROM manages WHERE user_id = $1 ORDER BY property`, [row.id])
      user = { ...row, manages: manages.map((m) => m.property) }
    }
  }
  return { visitor, session, user }
}

export interface Preferences { lang: Lang; cur: Currency }

export async function preferences(identity: Identity): Promise<Preferences> {
  const row = identity.session
    ? await one<Preferences>(pool, `SELECT lang, cur FROM sessions WHERE id = $1`, [identity.session])
    : identity.visitor
      ? await one<Preferences>(pool, `SELECT lang, cur FROM visitors WHERE id = $1`, [identity.visitor])
      : undefined
  return { lang: row && LANGS.includes(row.lang) ? row.lang : 'en', cur: row && CURRENCIES.includes(row.cur) ? row.cur : 'EUR' }
}
