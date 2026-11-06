import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from '../../domain/sections.js';
import { query, queryOn, type Queryable } from '../db/pool.js';
import type { SignedInPerson } from '../http/router.js';

export interface PersonRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  newsroom_slug: string | null;
  contributor_handle: string | null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}

export function passwordMatches(stored: string, password: string): boolean {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(digest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function toSignedIn(row: PersonRow): SignedInPerson {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    newsroomSlug: row.newsroom_slug,
    contributorHandle: row.contributor_handle,
  };
}

export async function personBySession(sessionId: string): Promise<SignedInPerson | null> {
  const result = await query<PersonRow>(
    `select p.id, p.email, p.name, p.role, p.newsroom_slug, p.contributor_handle
     from sessions s join people p on p.id = s.person_id where s.id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  return row ? toSignedIn(row) : null;
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ person: SignedInPerson; sessionId: string } | null> {
  const result = await query<PersonRow & { password_hash: string }>(
    `select id, email, name, role, newsroom_slug, contributor_handle, password_hash
     from people where lower(email) = lower($1)`,
    [email],
  );
  const row = result.rows[0];
  if (!row || !passwordMatches(row.password_hash, password)) return null;
  const sessionId = randomUUID();
  await query('insert into sessions (id, person_id) values ($1, $2)', [sessionId, row.id]);
  return { person: toSignedIn(row), sessionId };
}

export async function signOut(sessionId: string): Promise<void> {
  await query('delete from sessions where id = $1', [sessionId]);
}

export interface NewsroomRow {
  slug: string;
  name: string;
  home_zone: string;
}

export async function newsroomBySlug(slug: string): Promise<NewsroomRow | null> {
  const result = await query<NewsroomRow>(
    'select slug, name, home_zone from newsrooms where slug = $1',
    [slug],
  );
  return result.rows[0] ?? null;
}

export async function sessionBody(person: SignedInPerson): Promise<{ user: Record<string, unknown> }> {
  const newsroom = person.newsroomSlug ? await newsroomBySlug(person.newsroomSlug) : null;
  return {
    user: {
      id: person.id,
      name: person.name,
      email: person.email,
      role: person.role,
      newsroom: newsroom
        ? { slug: newsroom.slug, name: newsroom.name, home_zone: newsroom.home_zone }
        : null,
      contributor_handle: person.contributorHandle,
    },
  };
}

export async function contributorNames(): Promise<Map<string, string>> {
  const result = await query<{ contributor_handle: string; name: string }>(
    `select contributor_handle, name from people
     where contributor_handle is not null order by name`,
  );
  return new Map(result.rows.map((row) => [row.contributor_handle, row.name]));
}

export interface MailRecipient {
  id: string;
  email: string;
  name: string;
}

/** The licensing picture editor and every licensing manager of their newsroom. */
export async function licenceRecipients(
  client: Queryable,
  licensedBy: string,
  newsroomSlug: string,
): Promise<MailRecipient[]> {
  const result = await queryOn<MailRecipient>(
    client,
    `select id, email, name from people
     where id = $1 or (newsroom_slug = $2 and role = 'licensing_manager')
     order by id`,
    [licensedBy, newsroomSlug],
  );
  return result.rows;
}

/**
 * Every picture editor who licensed the essay and every licensing manager of a
 * licensee newsroom, read before the takedown revokes those licences.
 */
export async function takedownRecipients(client: Queryable, essayId: string): Promise<MailRecipient[]> {
  const result = await queryOn<MailRecipient>(
    client,
    `select distinct p.id, p.email, p.name from people p
     where p.id in (select licensed_by from licences where essay_id = $1 and state <> 'revoked')
        or (p.role = 'licensing_manager'
            and p.newsroom_slug in (select newsroom_slug from licences where essay_id = $1 and state <> 'revoked'))
     order by p.id`,
    [essayId],
  );
  return result.rows;
}
