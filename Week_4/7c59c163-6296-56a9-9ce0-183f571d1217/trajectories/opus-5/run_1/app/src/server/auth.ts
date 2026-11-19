import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pool } from './db/pool.js';
import type { Db } from './db/pool.js';
import type { Member, Role, Venue } from './domain/types.js';
import { ROLES } from './domain/types.js';
import { groupNamesOfUser } from './providers/keycloak.js';
import type { Identity } from './providers/keycloak.js';

export const SESSION_COOKIE = 'pv_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined) return {};
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function setCookie(
  response: ServerResponse,
  name: string,
  value: string,
  maxAgeSeconds: number,
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  const existing = response.getHeader('set-cookie');
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  response.setHeader('set-cookie', [...list, parts.join('; ')]);
}

export function clearCookie(response: ServerResponse, name: string): void {
  setCookie(response, name, '', 0);
}

export interface Actor {
  member: Member;
  venue: Venue | null;
  apiKeyId: string | null;
}

export async function venueById(db: Db, venueId: string): Promise<Venue | null> {
  const result = await db.query<Venue>(
    'select id, slug, name, time_zone, taker_fee_bps, maker_fee_bps, flagship_symbol from venues where id = $1',
    [venueId],
  );
  return result.rows[0] ?? null;
}

export async function venueBySlug(db: Db, slug: string): Promise<Venue | null> {
  const result = await db.query<Venue>(
    'select id, slug, name, time_zone, taker_fee_bps, maker_fee_bps, flagship_symbol from venues where slug = $1',
    [slug],
  );
  return result.rows[0] ?? null;
}

export async function memberById(db: Db, memberId: string): Promise<Member | null> {
  const result = await db.query<Member>(
    'select id, venue_id, keycloak_user_id, username, display_name, email, roles from members where id = $1',
    [memberId],
  );
  return result.rows[0] ?? null;
}

async function actorOf(memberId: string, apiKeyId: string | null): Promise<Actor | null> {
  const member = await memberById(pool, memberId);
  if (member === null) return null;
  const venue = member.venue_id === null ? null : await venueById(pool, member.venue_id);
  return { member, venue, apiKeyId };
}

/**
 * The venue comes from the person's Keycloak venue group, read through the admin API, never from
 * the browser; realm roles come from the token.
 */
export async function upsertMemberFromIdentity(identity: Identity): Promise<Member> {
  const groups = await groupNamesOfUser(identity.keycloakUserId);
  const slug = groups
    .map((name) => (name.startsWith('/venue-') ? name.slice('/venue-'.length) : name.startsWith('venue-') ? name.slice('venue-'.length) : null))
    .find((value): value is string => value !== null);
  const venue = slug === undefined ? null : await venueBySlug(pool, slug);

  const existing = await pool.query<Member>(
    'select id, venue_id, keycloak_user_id, username, display_name, email, roles from members where keycloak_user_id = $1',
    [identity.keycloakUserId],
  );
  const roles = ROLES.filter((role) => identity.roles.includes(role));
  const current = existing.rows[0];
  if (current !== undefined) {
    const updated = await pool.query<Member>(
      `update members set venue_id = $2, username = $3, email = $4, roles = $5 where id = $1
       returning id, venue_id, keycloak_user_id, username, display_name, email, roles`,
      [current.id, venue?.id ?? null, identity.username, identity.email, roles],
    );
    return updated.rows[0] as Member;
  }

  const id = randomUUID();
  const inserted = await pool.query<Member>(
    `insert into members (id, venue_id, keycloak_user_id, username, display_name, email, roles)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id, venue_id, keycloak_user_id, username, display_name, email, roles`,
    [id, venue?.id ?? null, identity.keycloakUserId, identity.username, identity.displayName, identity.email, roles],
  );
  await pool.query('insert into member_balances (member_id) values ($1) on conflict do nothing', [id]);
  return inserted.rows[0] as Member;
}

export async function createSession(response: ServerResponse, memberId: string): Promise<void> {
  const id = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into sessions (id, member_id, expires_at) values ($1,$2, now() + ($3 || ' seconds')::interval)`,
    [id, memberId, SESSION_TTL_SECONDS],
  );
  setCookie(response, SESSION_COOKIE, id, SESSION_TTL_SECONDS);
}

export async function destroySession(request: IncomingMessage): Promise<void> {
  const id = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (id !== undefined) await pool.query('delete from sessions where id = $1', [id]);
}

const BEARER = /^Bearer\s+(.+)$/i;
const API_KEY = /^pv_([0-9a-f]{12})_([0-9a-f]{40})$/;

export const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

export function mintApiKeySecret(): { keyId: string; secret: string } {
  const keyId = randomBytes(6).toString('hex');
  return { keyId, secret: `pv_${keyId}_${randomBytes(20).toString('hex')}` };
}

export interface ApiKeyActor extends Actor {
  apiKeyId: string;
  apiKeyRecordId: string;
}

async function actorFromApiKey(secret: string): Promise<ApiKeyActor | null> {
  const parsed = API_KEY.exec(secret);
  if (parsed === null) return null;
  const result = await pool.query<{ id: string; key_id: string; member_id: string; secret_hash: string }>(
    'select id, key_id, member_id, secret_hash from api_keys where key_id = $1 and revoked_at is null',
    [parsed[1]],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const expected = Buffer.from(row.secret_hash, 'hex');
  const given = Buffer.from(hashSecret(secret), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const actor = await actorOf(row.member_id, row.key_id);
  return actor === null ? null : { ...actor, apiKeyId: row.key_id, apiKeyRecordId: row.id };
}

export interface Authentication {
  actor: Actor | null;
  viaApiKey: boolean;
}

export async function authenticate(request: IncomingMessage): Promise<Authentication> {
  const bearer = BEARER.exec(request.headers.authorization ?? '');
  if (bearer !== null) {
    return { actor: await actorFromApiKey(bearer[1] as string), viaApiKey: true };
  }
  const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (sessionId === undefined) return { actor: null, viaApiKey: false };
  const result = await pool.query<{ member_id: string }>(
    'select member_id from sessions where id = $1 and expires_at > now()',
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) return { actor: null, viaApiKey: false };
  return { actor: await actorOf(row.member_id, null), viaApiKey: false };
}

export const hasRole = (actor: Actor, roles: readonly Role[]): boolean =>
  roles.some((role) => actor.member.roles.includes(role));
