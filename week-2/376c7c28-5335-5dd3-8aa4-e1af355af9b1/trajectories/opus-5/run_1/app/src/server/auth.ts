import { config } from './config.ts';
import { now } from './clock.ts';
import { first, pool, type Queryable } from './db/pool.ts';
import { publish } from './events.ts';
import { randomToken } from './security.ts';
import type { Actor, PersonRole, StudioRow } from './http/context.ts';

interface SessionJoinRow {
  readonly session_id: string;
  readonly person_id: string;
  readonly role: PersonRole;
  readonly membership: 'member' | 'drop_off' | null;
  readonly name: string;
  readonly handle: string;
  readonly email: string;
  readonly studio_id: string;
  readonly slug: string;
  readonly studio_name: string;
  readonly time_zone: string;
  readonly pickup_window_days: number;
  readonly storage_fee_cents: number;
}

export async function actorForSession(sessionId: string): Promise<Actor | null> {
  if (sessionId === '' || sessionId.length > 200 || sessionId.includes('\0')) return null;
  const row = await first<SessionJoinRow>(
    pool,
    `select s.id as session_id, p.id as person_id, p.role, p.membership, p.name, p.handle, p.email,
            st.id as studio_id, st.slug, st.name as studio_name, st.time_zone,
            st.pickup_window_days, st.storage_fee_cents
       from sessions s
       join people p on p.id = s.person_id
       join studios st on st.id = s.studio_id
      where s.id = $1 and s.ended_at is null and s.expires_at > $2 and p.active`,
    [sessionId, now()],
  );
  if (!row) return null;
  const studio: StudioRow = {
    id: row.studio_id,
    slug: row.slug,
    name: row.studio_name,
    time_zone: row.time_zone,
    pickup_window_days: row.pickup_window_days,
    storage_fee_cents: row.storage_fee_cents,
  };
  return {
    sessionId: row.session_id,
    personId: row.person_id,
    role: row.role,
    membership: row.membership,
    name: row.name,
    handle: row.handle,
    email: row.email,
    studio,
  };
}

export async function createSession(
  client: Queryable,
  studioId: string,
  personId: string,
): Promise<string> {
  const id = randomToken();
  const at = now();
  const expires = new Date(at.getTime() + config.sessionTtlSeconds * 1_000);
  await client.query(
    'insert into sessions (id, studio_id, person_id, created_at, expires_at) values ($1,$2,$3,$4,$5)',
    [id, studioId, personId, at, expires],
  );
  return id;
}

export async function endSession(sessionId: string, studioId: string): Promise<void> {
  await pool.query('update sessions set ended_at = $2 where id = $1 and ended_at is null', [
    sessionId,
    now(),
  ]);
  await publish(pool, {
    kind: 'session',
    id: sessionId,
    studio_id: studioId,
    session_id: sessionId,
  });
}

export async function endEverySession(
  client: Queryable,
  studioId: string,
  personId: string,
): Promise<void> {
  await client.query('update sessions set ended_at = $2 where person_id = $1 and ended_at is null', [
    personId,
    now(),
  ]);
}

export function sessionCookie(id: string, secure: boolean): string {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${config.sessionTtlSeconds}`];
  if (secure) flags.push('Secure');
  return `kd_session=${id}; ${flags.join('; ')}`;
}

export function clearedCookie(secure: boolean): string {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) flags.push('Secure');
  return `kd_session=; ${flags.join('; ')}`;
}

export function readCookie(header: string, name: string): string {
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0 && trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return '';
}
