import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query, type Queryable } from './pool.js';
import type { LinkStatus, Role } from '../domain/types.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export interface UserRow {
  id: string;
  role: Role;
  name: string;
  email: string;
  tz: string;
  coach_code: string | null;
  series_start: string | null;
  start_ctl: number;
  start_atl: number;
}

export const USER_COLUMNS = 'id, role, name, email, tz, coach_code, series_start, start_ctl, start_atl';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 32);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, digest] = stored.split(':');
  if (!salt || !digest) return false;
  const derived = await scryptAsync(password, salt, 32);
  const expected = Buffer.from(digest, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function findUserByEmail(client: Queryable, email: string): Promise<(UserRow & { password_hash: string }) | null> {
  const rows = await query<UserRow & { password_hash: string }>(
    client,
    `select ${USER_COLUMNS}, password_hash from users where lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findUser(client: Queryable, id: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(client, `select ${USER_COLUMNS} from users where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findUserByCoachCode(client: Queryable, code: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    client,
    `select ${USER_COLUMNS} from users where coach_code = $1 and role = 'coach'`,
    [code],
  );
  return rows[0] ?? null;
}

export async function createSession(client: Queryable, userId: string): Promise<string> {
  const id = randomUUID();
  await query(client, 'insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
}

export async function findSessionUser(client: Queryable, sessionId: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    client,
    `select ${USER_COLUMNS.split(', ').map((column) => `u.${column}`).join(', ')}
     from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

export async function deleteSession(client: Queryable, sessionId: string): Promise<void> {
  await query(client, 'delete from sessions where id = $1', [sessionId]);
}

export async function createOneTimeToken(client: Queryable, userId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await query(client, 'insert into one_time_tokens (token, user_id) values ($1, $2)', [token, userId]);
  return token;
}

export async function consumeOneTimeToken(client: Queryable, token: string): Promise<string | null> {
  const rows = await query<{ user_id: string }>(
    client,
    'update one_time_tokens set used = true where token = $1 and used = false returning user_id',
    [token],
  );
  return rows[0]?.user_id ?? null;
}

export interface LinkRow {
  id: string;
  coach_id: string;
  athlete_id: string;
  coach_name: string;
  athlete_name: string;
  status: Exclude<LinkStatus, 'expired'>;
  expires_at: Date;
}

const LINK_SELECT = `select l.id, l.coach_id, l.athlete_id, l.status, l.expires_at,
    c.name as coach_name, a.name as athlete_name
  from links l join users c on c.id = l.coach_id join users a on a.id = l.athlete_id`;

export async function findLink(client: Queryable, id: string): Promise<LinkRow | null> {
  const rows = await query<LinkRow>(client, `${LINK_SELECT} where l.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function linksForUser(client: Queryable, userId: string): Promise<LinkRow[]> {
  return query<LinkRow>(
    client,
    `${LINK_SELECT} where (l.coach_id = $1 or l.athlete_id = $1) and l.status <> 'removed'
     order by l.created_at`,
    [userId],
  );
}

export async function linksBetween(
  client: Queryable,
  coachId: string,
  athleteId: string,
): Promise<LinkRow[]> {
  return query<LinkRow>(
    client,
    `${LINK_SELECT} where l.coach_id = $1 and l.athlete_id = $2 order by l.created_at`,
    [coachId, athleteId],
  );
}

export async function insertLink(
  client: Queryable,
  args: { coachId: string; athleteId: string; status: LinkRow['status']; expiresAt: Date; seedKey?: string | null },
): Promise<LinkRow> {
  const id = randomUUID();
  const rows = await query<{ id: string }>(
    client,
    `insert into links (id, coach_id, athlete_id, status, expires_at, seed_key)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (seed_key) do update set coach_id = excluded.coach_id,
       athlete_id = excluded.athlete_id, status = excluded.status, expires_at = excluded.expires_at
     returning id`,
    [id, args.coachId, args.athleteId, args.status, args.expiresAt, args.seedKey ?? null],
  );
  return (await findLink(client, (rows[0] as { id: string }).id)) as LinkRow;
}

export async function setLinkStatus(
  client: Queryable,
  id: string,
  from: LinkRow['status'],
  to: LinkRow['status'],
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    client,
    'update links set status = $3 where id = $1 and status = $2 returning id',
    [id, from, to],
  );
  return rows.length === 1;
}

export async function acceptedAthleteIds(client: Queryable, coachId: string): Promise<string[]> {
  const rows = await query<{ athlete_id: string }>(
    client,
    `select l.athlete_id from links l join users a on a.id = l.athlete_id
     where l.coach_id = $1 and l.status = 'accepted' order by a.name`,
    [coachId],
  );
  return rows.map((row) => row.athlete_id);
}

export async function acceptedCoachIds(client: Queryable, athleteId: string): Promise<string[]> {
  const rows = await query<{ coach_id: string }>(
    client,
    `select coach_id from links where athlete_id = $1 and status = 'accepted'`,
    [athleteId],
  );
  return rows.map((row) => row.coach_id);
}

export async function isLinkedCoach(
  client: Queryable,
  coachId: string,
  athleteId: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    client,
    `select id from links where coach_id = $1 and athlete_id = $2 and status = 'accepted'`,
    [coachId, athleteId],
  );
  return rows.length === 1;
}
