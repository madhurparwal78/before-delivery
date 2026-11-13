import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { cookieValue, sha256Hex } from './http'
import { query, type Db } from './db'

const SESSION_COOKIE = 'skinout_session'
const THIRTY_DAYS = 60 * 60 * 24 * 30

export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}.${(await derive(passphrase, salt)).toString('hex')}`
}

function derive(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(passphrase, salt, 32, (error, key) => (error ? reject(error) : resolve(key))))
}

export async function passphraseMatches(passphrase: string, stored: string): Promise<boolean> {
  const [salt = '', hash = ''] = stored.split('.')
  const expected = Buffer.from(hash, 'hex')
  const actual = await derive(passphrase, Buffer.from(salt, 'hex'))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function openSession(db: Db): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await query('INSERT INTO sessions (token_hash) VALUES ($1)', [sha256Hex(token)], db)
  return token
}

export async function endSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [sha256Hex(token)])
}

export function sessionToken(cookieHeader: string | undefined): string | null {
  return cookieValue(cookieHeader, SESSION_COOKIE)
}

export async function isLive(token: string | null): Promise<boolean> {
  if (token === null) return false
  return (await query('SELECT 1 FROM sessions WHERE token_hash = $1', [sha256Hex(token)])).length > 0
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${THIRTY_DAYS}`
}

export const CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
