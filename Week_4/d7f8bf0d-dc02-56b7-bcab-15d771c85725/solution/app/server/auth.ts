import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { sha256Hex } from './canonical'
import { idleSeconds } from './config'
import { db, one } from './db'
import { invalidCredentials } from './http/errors'
import type { Role, UserSummary } from '../shared/domain'

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>
const KEY_LENGTH = 32

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEY_LENGTH)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

async function matches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':')
  const derived = await scrypt(password, Buffer.from(salt, 'hex'), KEY_LENGTH)
  return timingSafeEqual(derived, Buffer.from(key, 'hex'))
}

export interface AuthUser extends UserSummary {
  is_founder: boolean
  walkthrough_done: boolean
}

// Compared against when the email is unknown, so a wrong email and a wrong password take as long.
const UNKNOWN_PERSON_HASH = hashPassword('unknown person')

export async function signIn(email: string, password: string): Promise<{ user: UserSummary; token: string }> {
  const found = await one<{ id: string; email: string; display_name: string; password_hash: string }>(
    db(), 'select id, email, display_name, password_hash from users where email = $1', [email.trim().toLowerCase()])
  if (!(await matches(password, found?.password_hash ?? (await UNKNOWN_PERSON_HASH))) || found === undefined) throw invalidCredentials()
  const token = randomBytes(32).toString('hex')
  await db().query('insert into auth_sessions (token_hash, user_id) values ($1, $2)', [sha256Hex(token), found.id])
  await db().query(`delete from auth_sessions where last_seen < now() - ($1 || ' seconds')::interval`, [String(idleSeconds)])
  return { user: { id: found.id, email: found.email, display_name: found.display_name }, token }
}

export async function signOut(token: string): Promise<void> {
  await db().query('delete from auth_sessions where token_hash = $1', [sha256Hex(token)])
}

// Each signed-in request renews the idle period; a token idle for longer is no longer a sign-in.
export async function userForToken(token: string): Promise<AuthUser | undefined> {
  return one<AuthUser>(db(),
    `with seen as (
       update auth_sessions set last_seen = now()
       where token_hash = $1 and last_seen > now() - ($2 || ' seconds')::interval returning user_id)
     select u.id, u.email, u.display_name, u.is_founder, u.walkthrough_done from users u join seen on seen.user_id = u.id`,
    [sha256Hex(token), String(idleSeconds)])
}

export async function roleIn(workspaceId: string, userId: string): Promise<Role | undefined> {
  return (await one<{ role: Role }>(db(), 'select role from members where workspace_id = $1 and user_id = $2', [workspaceId, userId]))?.role
}
