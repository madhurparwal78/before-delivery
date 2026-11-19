import type { Db } from './db.js';
import { one } from './db.js';
import { forbidden, notFound } from './errors.js';
import { assertTotp } from './guards.js';
import type { SessionUser } from './accounts.js';

export interface CommunityRef {
  id: string;
  name: string;
  type: 'public' | 'restricted';
  memberCount: number;
  ownerId: string;
}

export async function communityRef(db: Db, name: string): Promise<CommunityRef> {
  const row = await one<{ id: string; name: string; type: 'public' | 'restricted'; member_count: number; owner_id: string }>(db,
    'SELECT id, name, type, member_count, owner_id FROM communities WHERE name_key = lower($1)', [name]);
  if (!row) throw notFound('No such community');
  return { id: row.id, name: row.name, type: row.type, memberCount: row.member_count, ownerId: row.owner_id };
}

/** The owner appoints and removes moderators; the two-factor rule applies to them like any moderator. */
export function requireOwner(user: SessionUser, community: CommunityRef): void {
  if (user.id !== community.ownerId) throw forbidden('Only the owner can do this');
  assertTotp(user, { memberCount: community.memberCount });
}

/** The user who may post here: a moderator, an approved poster, or anyone in a public community. */
export async function maySubmit(db: Db, user: SessionUser, community: CommunityRef): Promise<boolean> {
  if (community.type === 'public') return true;
  return (await one(db,
    `SELECT 1 FROM moderators WHERE community_id = $1 AND user_id = $2
     UNION ALL SELECT 1 FROM approved_posters WHERE community_id = $1 AND user_id = $2`, [community.id, user.id])) !== null;
}
