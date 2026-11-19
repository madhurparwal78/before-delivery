import { config } from '../core/config.js';
import { db, many, one, transaction, type Queryable } from '../core/db.js';
import { ApiError, errors } from '../core/errors.js';
import { iso } from '../core/time.js';
import { copy } from '../shared/copy.js';
import { emitMembership } from './events.js';
import { reservedCommunityName, validCommunityName } from './validation.js';
import { moderates, type Member, type Viewer } from './viewer.js';

export interface CommunityRow {
  id: string;
  name: string;
  title: string;
  description: string;
  type: 'public' | 'restricted';
  owner_id: string;
  member_count: number;
  show_mod_names: boolean;
  created_at: unknown;
}

export interface RuleRow {
  id: string;
  title: string;
  description: string;
}

export interface Community extends CommunityRow {
  rules: RuleRow[];
}

const COMMUNITY_SELECT = `
  select id, name, title, description, type, owner_id, member_count, show_mod_names, created_at
  from communities
`;

export async function loadCommunity(source: Queryable, name: string): Promise<Community | null> {
  const row = await one<CommunityRow>(source, `${COMMUNITY_SELECT} where name_ci = $1`, [name.toLowerCase()]);
  if (!row) return null;
  return { ...row, rules: await loadRules(source, String(row.id)) };
}

export async function loadCommunityById(source: Queryable, id: string): Promise<Community | null> {
  const row = await one<CommunityRow>(source, `${COMMUNITY_SELECT} where id = $1`, [id]);
  if (!row) return null;
  return { ...row, rules: await loadRules(source, String(row.id)) };
}

async function loadRules(source: Queryable, communityId: string): Promise<RuleRow[]> {
  const rows = await many<RuleRow>(
    source,
    'select id, title, description from community_rules where community_id = $1 order by position asc, id asc',
    [communityId],
  );
  return rows.map((rule) => ({ id: String(rule.id), title: rule.title, description: rule.description }));
}

export interface ViewerFlags {
  joined: boolean;
  isModerator: boolean;
  isOwner: boolean;
  canPost: boolean;
}

export async function viewerFlags(community: Community, viewer: Viewer): Promise<ViewerFlags> {
  if (!viewer.member) return { joined: false, isModerator: false, isOwner: false, canPost: false };
  const member = viewer.member;
  const rows = await db.query<{ joined: boolean; approved: boolean }>(
    `select
       exists (select 1 from memberships where community_id = $1 and member_id = $2) as joined,
       exists (select 1 from approved_posters where community_id = $1 and member_id = $2) as approved`,
    [community.id, member.id],
  );
  const state = rows.rows[0] ?? { joined: false, approved: false };
  const isModerator = moderates(viewer, String(community.id));
  const isOwner = String(community.owner_id) === member.id;
  const canPost =
    member.emailVerified && (community.type === 'public' || isModerator || state.approved === true);
  return { joined: state.joined === true, isModerator, isOwner, canPost };
}

export function communityProjection(community: Community, flags: ViewerFlags): Record<string, unknown> {
  return {
    id: String(community.id),
    name: community.name,
    title: community.title,
    description: community.description,
    type: community.type,
    memberCount: Number(community.member_count),
    rules: community.rules.map((rule) => ({ id: String(rule.id), title: rule.title, description: rule.description })),
    showModNames: community.show_mod_names === true,
    createdAt: iso(community.created_at),
    viewer: flags,
  };
}

export async function projectCommunity(community: Community, viewer: Viewer): Promise<Record<string, unknown>> {
  return communityProjection(community, await viewerFlags(community, viewer));
}

export interface CreateCommunityInput {
  name: string;
  title: string;
  description: string;
  type: 'public' | 'restricted';
}

export function validateCommunityInput(body: Record<string, unknown>): CreateCommunityInput {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description : '';
  const type = body.type === 'restricted' ? 'restricted' : body.type === 'public' ? 'public' : null;

  const fields: Record<string, string> = {};
  if (!validCommunityName(name)) fields.name = copy.community.nameInvalid;
  if (title.length < 1 || title.length > 100) fields.title = 'Titles are 1 to 100 characters';
  if (description.length > 500) fields.description = 'Descriptions are at most 500 characters';
  if (type === null) fields.type = 'Choose Public or Restricted';
  if (Object.keys(fields).length > 0) throw errors.validation('Check the highlighted fields', fields);

  return { name, title, description, type: type as 'public' | 'restricted' };
}

/** Name rules, reserved names, the account-age gate and the five-community limit, in one place. */
export async function createCommunity(member: Member, input: CreateCommunityInput): Promise<Community> {
  if (reservedCommunityName(input.name)) {
    throw new ApiError('RESERVED', copy.community.nameReserved, {
      fields: { name: copy.community.nameReserved },
    });
  }

  const ageDays = (Date.now() - new Date(member.createdAt).getTime()) / 86400000;
  if (ageDays < config.limits.communityMinAccountAgeDays) {
    throw errors.notEligible(copy.community.tooYoung(config.limits.communityMinAccountAgeDays));
  }

  const owned = await one<{ count: string }>(db, 'select count(*) as count from communities where owner_id = $1', [
    member.id,
  ]);
  if (Number(owned?.count ?? 0) >= 5) throw errors.notEligible(copy.community.ownLimit);

  const existing = await one(db, 'select 1 from communities where name_ci = $1', [input.name.toLowerCase()]);
  if (existing) {
    throw new ApiError('NAME_TAKEN', copy.community.nameTaken, {
      fields: { name: copy.community.nameTaken },
    });
  }

  return transaction(async (tx) => {
    const row = await one<CommunityRow>(
      tx,
      `insert into communities (name, name_ci, title, description, type, owner_id, member_count)
       values ($1, $2, $3, $4, $5, $6, 1)
       returning id, name, title, description, type, owner_id, member_count, show_mod_names, created_at`,
      [input.name, input.name.toLowerCase(), input.title, input.description, input.type, member.id],
    );
    const communityId = String(row?.id);
    await tx.query('insert into memberships (community_id, member_id) values ($1, $2)', [communityId, member.id]);
    await tx.query('insert into moderators (community_id, member_id, is_owner) values ($1, $2, true)', [
      communityId,
      member.id,
    ]);
    return { ...(row as CommunityRow), rules: [] };
  });
}

export interface MembershipResult {
  joined: boolean;
  memberCount: number;
}

/** Joining and leaving are idempotent and move the stored count in the membership transaction. */
export async function setMembership(
  community: Community,
  member: Member,
  joined: boolean,
): Promise<MembershipResult> {
  if (!joined && String(community.owner_id) === member.id) {
    throw errors.conflict('A community owner cannot leave their own community');
  }

  const result = await transaction(async (tx) => {
    await tx.query('select 1 from communities where id = $1 for update', [community.id]);
    const changed = joined
      ? (
          await tx.query('insert into memberships (community_id, member_id) values ($1, $2) on conflict do nothing', [
            community.id,
            member.id,
          ])
        ).rowCount
      : (
          await tx.query('delete from memberships where community_id = $1 and member_id = $2', [
            community.id,
            member.id,
          ])
        ).rowCount;

    const row = changed
      ? await one<{ member_count: number }>(
          tx,
          `update communities set member_count = member_count + $2 where id = $1 returning member_count`,
          [community.id, joined ? 1 : -1],
        )
      : await one<{ member_count: number }>(tx, 'select member_count from communities where id = $1', [community.id]);

    return { joined, memberCount: Number(row?.member_count ?? 0), changed: changed > 0 };
  });

  if (result.changed) await emitMembership(community.name, result.memberCount);
  return { joined: result.joined, memberCount: result.memberCount };
}

export async function isApprovedPoster(communityId: string, memberId: string): Promise<boolean> {
  const row = await one(db, 'select 1 from approved_posters where community_id = $1 and member_id = $2', [
    communityId,
    memberId,
  ]);
  return row !== null;
}

export async function listModerators(communityId: string): Promise<Array<{ username: string; isOwner: boolean }>> {
  const rows = await many<{ username: string; is_owner: boolean }>(
    db,
    `select m.username, o.is_owner from moderators o join members m on m.id = o.member_id
     where o.community_id = $1 order by o.is_owner desc, m.username asc`,
    [communityId],
  );
  return rows.map((row) => ({ username: row.username, isOwner: row.is_owner === true }));
}

export async function listApprovedPosters(communityId: string): Promise<Array<{ username: string }>> {
  const rows = await many<{ username: string }>(
    db,
    `select m.username from approved_posters a join members m on m.id = a.member_id
     where a.community_id = $1 order by m.username asc`,
    [communityId],
  );
  return rows.map((row) => ({ username: row.username }));
}

/** Two-factor is required for admins and for moderators of a community above the member threshold. */
export function requiresTwoFactor(community: Community): boolean {
  return Number(community.member_count) > config.limits.mod2faMemberThreshold;
}
