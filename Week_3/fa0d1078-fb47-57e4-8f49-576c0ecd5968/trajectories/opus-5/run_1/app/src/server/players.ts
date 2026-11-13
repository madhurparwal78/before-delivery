import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PlayerShape } from '../shared/api';
import { serverNow } from './clock';
import { query } from './db';
import { ApiError } from './errors';
import type { RequestContext } from './http';
import { SESSION_COOKIE } from './http';

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export interface PlayerRow {
  id: string;
  email: string;
  display_name: string;
  verified: boolean;
}

export function token(): string {
  return randomBytes(32).toString('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const key = await derive(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function playerShape(row: PlayerRow): PlayerShape {
  return {
    player_id: row.id,
    email: row.email,
    display_name: row.display_name,
    verified: row.verified,
  };
}

export async function createSession(playerId: string): Promise<string> {
  const value = token();
  await query('insert into sessions (token, player_id) values ($1, $2)', [value, playerId]);
  return value;
}

export async function endSession(value: string): Promise<void> {
  await query('delete from sessions where token = $1', [value]);
}

export async function endAllSessions(playerId: string): Promise<void> {
  await query('delete from sessions where player_id = $1', [playerId]);
}

export async function playerForSession(value: string): Promise<PlayerRow | null> {
  const found = await query<PlayerRow>(
    `select p.id, p.email, p.display_name, p.verified
       from sessions s join players p on p.id = s.player_id
      where s.token = $1`,
    [value],
  );
  return found.rows[0] ?? null;
}

export async function playerById(id: string): Promise<PlayerRow | null> {
  const found = await query<PlayerRow>(
    'select id, email, display_name, verified from players where id = $1',
    [id],
  );
  return found.rows[0] ?? null;
}

export async function currentPlayer(context: RequestContext): Promise<PlayerRow | null> {
  const value = context.cookies[SESSION_COOKIE];
  if (!value) return null;
  return playerForSession(value);
}

export async function requirePlayer(context: RequestContext): Promise<PlayerRow> {
  const player = await currentPlayer(context);
  if (!player) throw new ApiError('UNAUTHENTICATED');
  return player;
}

export async function requireVerifiedPlayer(context: RequestContext): Promise<PlayerRow> {
  const player = await requirePlayer(context);
  if (!player.verified) throw new ApiError('NOT_VERIFIED');
  return player;
}

export type TokenKind = 'verify' | 'reset';

interface TokenRow {
  token: string;
  player_id: string;
  kind: string;
  expires_at: string;
  used_at: string | null;
}

/** Looks a link token up and reports its outcome in the published order. */
export async function inspectToken(value: unknown, kind: TokenKind): Promise<string> {
  if (typeof value !== 'string' || value.length === 0) throw new ApiError('TOKEN_NOT_FOUND');
  const found = await query<TokenRow>(
    'select token, player_id, kind, expires_at, used_at from auth_tokens where token = $1 and kind = $2',
    [value, kind],
  );
  const row = found.rows[0];
  if (!row) throw new ApiError('TOKEN_NOT_FOUND');
  if (row.used_at !== null) throw new ApiError('TOKEN_USED');
  if (new Date(row.expires_at).getTime() <= serverNow().getTime()) {
    throw new ApiError('TOKEN_EXPIRED');
  }
  return row.player_id;
}

/** A link works once: the first caller to claim it wins. */
export async function consumeToken(value: string): Promise<void> {
  const claimed = await query(
    'update auth_tokens set used_at = $2 where token = $1 and used_at is null',
    [value, serverNow().toISOString()],
  );
  if (claimed.rowCount === 0) throw new ApiError('TOKEN_USED');
}

export function newId(): string {
  return randomUUID();
}
