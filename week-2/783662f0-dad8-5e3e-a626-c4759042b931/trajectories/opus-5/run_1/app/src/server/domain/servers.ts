import type { PoolClient } from 'pg';
import { one, query } from '../db/pool.js';
import { fail } from '../errors.js';
import { etagOf } from '../http/conditional.js';
import type { SessionUser } from '../http/session.js';
import { PLANS, type PlanId } from '../../shared/domain.js';
import type { ServerObject, ServerStatus, StatusWord } from '../../shared/types.js';
import { instant, zoneLabel } from '../util.js';

export interface ServerRow {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  plan: PlanId;
  pending_plan: PlanId | null;
  status: ServerStatus;
  time_zone: string;
  weather_seed: number;
  season: number;
  balance: string;
  past_due_since: Date | null;
  suspends_at: Date | null;
  kb_account_id: string | null;
  provider_reachable: boolean;
  checked_at: Date | null;
  revision: string;
  created_at: Date;
}

export const STATUS_WORDS: Readonly<Record<ServerStatus, StatusWord>> = {
  pending_approval: 'PENDING',
  active: 'PAID',
  past_due: 'PAST DUE',
  suspended: 'SUSPENDED',
};

export interface Scope {
  readonly server: ServerRow;
  readonly user: SessionUser;
  readonly isOwner: boolean;
}

const SELECT = 'SELECT * FROM servers';

export const loadServerById = (id: string): Promise<ServerRow | null> =>
  one<ServerRow>(`${SELECT} WHERE id = $1`, [id]);

export const loadServerBySlug = (slug: string): Promise<ServerRow | null> =>
  one<ServerRow>(`${SELECT} WHERE slug = $1`, [slug]);

export const allServers = (): Promise<ServerRow[]> => query<ServerRow>(SELECT);

export async function isMember(serverId: string, userId: string): Promise<boolean> {
  const row = await one<{ role: string }>(
    'SELECT role FROM members WHERE server_id = $1 AND user_id = $2',
    [serverId, userId],
  );
  return row !== null;
}

/**
 * Per-server query scoping lives here: a record of another server, or of a
 * server the caller does not belong to, answers the same 404 as an unknown id.
 */
export async function scopeBySlug(slug: string, user: SessionUser): Promise<Scope> {
  const server = await loadServerBySlug(slug);
  if (server === null) throw fail('not_found');
  if (!(await isMember(server.id, user.id))) throw fail('not_found');
  return { server, user, isOwner: server.owner_id === user.id };
}

export async function scopeByServerId(serverId: string, user: SessionUser): Promise<Scope> {
  const server = await loadServerById(serverId);
  if (server === null) throw fail('not_found');
  if (!(await isMember(server.id, user.id))) throw fail('not_found');
  return { server, user, isOwner: server.owner_id === user.id };
}

export function requireOwner(scope: Scope): Scope {
  if (!scope.isOwner) throw fail('forbidden');
  return scope;
}

/**
 * A suspended or not-yet-active server refuses every play, trade, purchase and
 * save action.
 */
export function requirePlayable(server: ServerRow): void {
  if (server.status === 'suspended') throw fail('server_suspended');
  if (server.status === 'pending_approval') throw fail('server_inactive');
}

export const serverEtag = (server: ServerRow): string =>
  etagOf('server', server.id, server.revision);

export const suspendsAtLabel = (server: ServerRow): string | null =>
  server.suspends_at === null ? null : zoneLabel(server.suspends_at, server.time_zone);

export async function serverObject(server: ServerRow, userId: string): Promise<ServerObject> {
  const owner = await one<{ handle: string }>('SELECT handle FROM users WHERE id = $1', [
    server.owner_id,
  ]);
  const worlds = await query<{ slug: string; name: string }>(
    'SELECT slug, name FROM worlds WHERE server_id = $1 ORDER BY created_at, slug',
    [server.id],
  );
  const counts = await one<{ members: string; characters: string }>(
    `SELECT (SELECT count(*) FROM members WHERE server_id = $1) AS members,
            (SELECT count(*) FROM characters WHERE server_id = $1) AS characters`,
    [server.id],
  );
  return {
    id: server.id,
    slug: server.slug,
    name: server.name,
    owner: owner?.handle ?? '',
    role: server.owner_id === userId ? 'owner' : 'member',
    status: server.status,
    status_word: STATUS_WORDS[server.status],
    suspends_at: server.suspends_at === null ? null : instant(server.suspends_at),
    suspends_at_label: suspendsAtLabel(server),
    time_zone: server.time_zone,
    plan: server.plan,
    season: server.season,
    worlds: worlds.map((world) => ({ slug: world.slug, name: world.name })),
    member_count: Number(counts?.members ?? 0),
    character_count: Number(counts?.characters ?? 0),
  };
}

/** Limits come from the confirmed plan only. */
export const planOf = (server: ServerRow) => PLANS[server.plan];
