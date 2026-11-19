/* Community projections: moderator view of the mod log, member counts and the
   two-factor requirement, each decided once. */
import type { Services } from './routes.js';
import { ApiError } from './errors.js';

export type Community = {
  id: number;
  name: string;
  title: string;
  description: string;
  type: 'public' | 'restricted';
  memberCount: number;
  showModNames: boolean;
  createdAt: Date;
};

export async function loadCommunityByName(services: Services, name: string): Promise<Community> {
  const rows = await services.db.query(
    `SELECT id, name, title, description, type, member_count, show_mod_names, created_at FROM communities WHERE name_lc = $1`,
    [name.toLowerCase()]
  );
  if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
  const r = rows.rows[0] as { id: string; name: string; title: string; description: string; type: string; member_count: number; show_mod_names: boolean; created_at: Date };
  return {
    id: Number(r.id),
    name: r.name,
    title: r.title,
    description: r.description,
    type: r.type === 'restricted' ? 'restricted' : 'public',
    memberCount: r.member_count,
    showModNames: r.show_mod_names,
    createdAt: new Date(r.created_at),
  };
}

export type MemberRole = { joined: boolean; isModerator: boolean; isOwner: boolean; isApprovedPoster: boolean };

export async function memberRole(services: Services, communityId: number, accountId: number | null): Promise<MemberRole> {
  if (accountId === null) return { joined: false, isModerator: false, isOwner: false, isApprovedPoster: false };
  const rows = await services.db.query(
    `SELECT
       EXISTS(SELECT 1 FROM memberships WHERE community_id = $1 AND account_id = $2) AS joined,
       EXISTS(SELECT 1 FROM moderators WHERE community_id = $1 AND account_id = $2) AS is_mod,
       EXISTS(SELECT 1 FROM moderators WHERE community_id = $1 AND account_id = $2 AND is_owner) AS is_owner,
       EXISTS(SELECT 1 FROM approved_posters WHERE community_id = $1 AND account_id = $2) AS is_approved`,
    [communityId, accountId]
  );
  const r = rows.rows[0] as { joined: boolean; is_mod: boolean; is_owner: boolean; is_approved: boolean };
  return { joined: r.joined, isModerator: r.is_mod, isOwner: r.is_owner, isApprovedPoster: r.is_approved };
}

/* Two-factor is required for admins and for moderators of a community whose
   stored member count is above the threshold. */
export async function requiresTwoFactor(services: Services, account: { id: number; role: 'user' | 'admin'; totpEnabled: boolean }): Promise<boolean> {
  if (account.totpEnabled) return false;
  if (account.role === 'admin') return true;
  const rows = await services.db.query(
    `SELECT 1 FROM moderators m JOIN communities c ON c.id = m.community_id
     WHERE m.account_id = $1 AND c.member_count > $2 LIMIT 1`,
    [account.id, services.cfg.limits.mod2faThreshold]
  );
  return rows.rows.length > 0;
}

export async function communityModeratorRequires2fa(services: Services, communityId: number, account: { totpEnabled: boolean }): Promise<boolean> {
  if (account.totpEnabled) return false;
  const rows = await services.db.query(`SELECT member_count FROM communities WHERE id = $1`, [communityId]);
  if (rows.rows.length === 0) return false;
  const count = (rows.rows[0] as { member_count: number }).member_count;
  return count > services.cfg.limits.mod2faThreshold;
}
