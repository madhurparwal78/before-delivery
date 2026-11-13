import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { one, pool } from './db.ts'

export const SESSION_COOKIE = 'twinrow_session'

export interface User { id: string; email: string; name: string; reduceMotion: boolean }

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  const expected = Buffer.from(hash, 'hex')
  const actual = await derive(password, Buffer.from(salt, 'hex'))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function newToken(): string {
  return randomBytes(24).toString('base64url')
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function openSession(userId: string): Promise<string> {
  const token = newToken()
  await pool.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [digest(token), userId])
  return token
}

export async function closeSession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)])
}

export function cookieOf(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) {
      try { return decodeURIComponent(value.join('=')) } catch { return null }
    }
  }
  return null
}

export async function userOf(req: IncomingMessage): Promise<User | null> {
  const token = cookieOf(req, SESSION_COOKIE)
  if (!token) return null
  const found = await one<{ id: string; email: string; name: string; reduce_motion: boolean }>(pool,
    `SELECT u.id, u.email, u.name, u.reduce_motion FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [digest(token)])
  return found ? { id: found.id, email: found.email, name: found.name, reduceMotion: found.reduce_motion } : null
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
}

export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
