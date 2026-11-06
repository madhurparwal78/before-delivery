import crypto from 'node:crypto'
import type { DbClient } from './db.js'
import { caller_from_row } from './catalogue.js'
import type { ServerResponse } from 'node:http'
import type { Caller } from './catalogue.js'

export type { Caller }

export const SESSION_COOKIE = 'lf_session'

export function new_session_token(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function create_session(client: DbClient, user_id: number): Promise<string> {
  const token = new_session_token()
  await client.query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, user_id])
  return token
}

export async function destroy_session(client: DbClient, token: string): Promise<void> {
  await client.query('DELETE FROM sessions WHERE token=$1', [token])
}

export async function caller_from_token(client: DbClient, token: string | undefined): Promise<Caller | null> {
  if (!token) return null
  const result = await client.query(
    `SELECT u.id, u.email, u.name, u.role, u.trade_status, u.dial_mode
     FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1`,
    [token],
  )
  const row = result.rows[0]
  return row ? caller_from_row(row) : null
}

export function read_session_cookie(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  const cookie = Array.isArray(header) ? header[0]! : header
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

export function set_session_cookie(res: ServerResponse, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  )
}

export function clear_session_cookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}
