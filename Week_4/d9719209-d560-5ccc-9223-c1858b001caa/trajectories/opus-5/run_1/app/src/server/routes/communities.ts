import { db, many, one, transaction } from '../../core/db.js';
import { errors } from '../../core/errors.js';
import { config } from '../../core/config.js';
import {
  createCommunity,
  listApprovedPosters,
  listModerators,
  loadCommunity,
  projectCommunity,
  setMembership,
  validateCommunityInput,
  type Community,
} from '../../domain/communities.js';
import { emitAccount } from '../../domain/events.js';
import { modLogPage, modLogProjection, modLogView, writeModLog } from '../../domain/moderation.js';
import { feedPage, pinnedPosts, projectPosts } from '../../domain/posts.js';
import { parseSort } from '../../domain/validation.js';
import { loadMemberByUsername } from '../../domain/viewer.js';
import { communityOr404, requireModerator } from '../guards.js';
import { requireMember, requireVerified, route, sendJson, sendNoContent, type Ctx, type Route } from '../http.js';

async function projectAll(communities: Community[], ctx: Ctx): Promise<Record<string, unknown>[]> {
  const projected: Record<string, unknown>[] = [];
  for (const community of communities) projected.push(await projectCommunity(community, ctx.viewer));
  return projected;
}

export const communityRoutes: Route[] = [
  route(
    'GET',
    '/api/communities',
    async (ctx) => {
      const prefix = ctx.url.searchParams.get('q');
      const cursor = ctx.url.searchParams.get('cursor');
      const values: unknown[] = [];
      const conditions: string[] = [];
      if (prefix) {
        values.push(`${prefix.toLowerCase()}%`);
        conditions.push(`name_ci like $${values.length}`);
      }
      if (cursor) {
        const decoded = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
        if (decoded.length !== 2) throw errors.validation('This cursor is not valid', { cursor: 'This cursor is not valid' });
        values.push(Number(decoded[0]), decoded[1]);
        conditions.push(`(member_count, name) < ($${values.length - 1}::integer, $${values.length})`);
      }
      const rows = await many<{ name: string }>(
        db,
        `select name from communities ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
         order by member_count desc, name asc limit ${config.pageSize + 1}`,
        values,
      );
      const page = rows.slice(0, config.pageSize);
      const communities: Community[] = [];
      for (const row of page) {
        const community = await loadCommunity(db, row.name);
        if (community) communities.push(community);
      }
      const last = communities[communities.length - 1];
      const nextCursor =
        rows.length > config.pageSize && last
          ? Buffer.from(`${last.member_count}|${last.name}`, 'utf8').toString('base64url')
          : null;
      sendJson(ctx, 200, { items: await projectAll(communities, ctx), nextCursor });
    },
    'none',
  ),

  route(
    'GET',
    '/api/communities/mine',
    async (ctx) => {
      const member = requireMember(ctx);
      const rows = await many<{ name: string }>(
        db,
        `select c.name from memberships m join communities c on c.id = m.community_id
         where m.member_id = $1 order by c.name asc`,
        [member.id],
      );
      const communities: Community[] = [];
      for (const row of rows) {
        const community = await loadCommunity(db, row.name);
        if (community) communities.push(community);
      }
      sendJson(ctx, 200, { items: await projectAll(communities, ctx) });
    },
    'none',
  ),

  route('POST', '/api/communities', async (ctx) => {
    const member = requireVerified(ctx, 'Verify your email to create a community');
    const input = validateCommunityInput(ctx.body);
    const community = await createCommunity(member, input);
    ctx.viewer.moderatorOf.add(String(community.id));
    sendJson(ctx, 201, await projectCommunity(community, ctx.viewer));
  }),

  route(
    'GET',
    '/api/communities/:name',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      sendJson(ctx, 200, await projectCommunity(community, ctx.viewer));
    },
    'none',
  ),

  route('PATCH', '/api/communities/:name', async (ctx) => {
    const community = await communityOr404(ctx.params.name);
    requireModerator(ctx, community);
    const title = typeof ctx.body.title === 'string' ? ctx.body.title.trim() : null;
    const description = typeof ctx.body.description === 'string' ? ctx.body.description : null;
    const showModNames = typeof ctx.body.showModNames === 'boolean' ? ctx.body.showModNames : null;
    const fields: Record<string, string> = {};
    if (title !== null && (title.length < 1 || title.length > 100)) fields.title = 'Titles are 1 to 100 characters';
    if (description !== null && description.length > 500) {
      fields.description = 'Descriptions are at most 500 characters';
    }
    if (Object.keys(fields).length > 0) throw errors.validation('Check the highlighted fields', fields);

    await db.query(
      `update communities set title = coalesce($2, title), description = coalesce($3, description),
         show_mod_names = coalesce($4, show_mod_names) where id = $1`,
      [community.id, title, description, showModNames],
    );
    const updated = await communityOr404(ctx.params.name);
    sendJson(ctx, 200, await projectCommunity(updated, ctx.viewer));
  }),

  route('PUT', '/api/communities/:name/rules', async (ctx) => {
    const community = await communityOr404(ctx.params.name);
    requireModerator(ctx, community);
    const raw = Array.isArray(ctx.body.rules) ? ctx.body.rules : null;
    if (!raw || raw.length > 15) throw errors.validation('Check the rules', { rules: 'A community has at most 15 rules' });
    const rules = raw.map((entry) => {
      const value = entry as Record<string, unknown>;
      return {
        title: typeof value.title === 'string' ? value.title.trim() : '',
        description: typeof value.description === 'string' ? value.description : '',
      };
    });
    if (rules.some((rule) => rule.title.length < 1 || rule.title.length > 100 || rule.description.length > 500)) {
      throw errors.validation('Check the rules', { rules: 'Rule titles are 1 to 100 characters' });
    }
    await transaction(async (tx) => {
      await tx.query('delete from community_rules where community_id = $1', [community.id]);
      for (const [index, rule] of rules.entries()) {
        await tx.query(
          'insert into community_rules (community_id, position, title, description) values ($1, $2, $3, $4)',
          [community.id, index, rule.title, rule.description],
        );
      }
    });
    sendJson(ctx, 200, await projectCommunity(await communityOr404(ctx.params.name), ctx.viewer));
  }),

  route('PUT', '/api/communities/:name/membership', async (ctx) => {
    const member = requireMember(ctx);
    const community = await communityOr404(ctx.params.name);
    const result = await setMembership(community, member, true);
    sendJson(ctx, 200, { joined: true, memberCount: result.memberCount });
  }),

  route('DELETE', '/api/communities/:name/membership', async (ctx) => {
    const member = requireMember(ctx);
    const community = await communityOr404(ctx.params.name);
    const result = await setMembership(community, member, false);
    sendJson(ctx, 200, { joined: false, memberCount: result.memberCount });
  }),

  route(
    'GET',
    '/api/communities/:name/moderators',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      requireModerator(ctx, community);
      sendJson(ctx, 200, { items: await listModerators(String(community.id)) });
    },
    'none',
  ),

  route('POST', '/api/communities/:name/moderators', async (ctx) => {
    const community = await communityOr404(ctx.params.name);
    const owner = requireModerator(ctx, community);
    if (String(community.owner_id) !== owner.id) throw errors.forbidden('Only the owner can add moderators');
    const target = await loadMemberByUsername(typeof ctx.body.username === 'string' ? ctx.body.username : '');
    if (!target) throw errors.notFound('Account not found');
    const existing = await one(db, 'select 1 from moderators where community_id = $1 and member_id = $2', [
      community.id,
      target.id,
    ]);
    if (existing) throw errors.conflict('They are already a moderator');
    await transaction(async (tx) => {
      await tx.query('insert into moderators (community_id, member_id) values ($1, $2)', [community.id, target.id]);
      await tx.query('insert into memberships (community_id, member_id) values ($1, $2) on conflict do nothing', [
        community.id,
        target.id,
      ]);
      await writeModLog(tx, {
        communityId: String(community.id),
        moderatorId: owner.id,
        action: 'add_moderator',
        targetType: 'user',
        targetId: target.username,
        publicReason: null,
        privateNote: null,
      });
    });
    sendJson(ctx, 201, { username: target.username, isOwner: false });
  }),

  route('DELETE', '/api/communities/:name/moderators/:username', async (ctx) => {
    const community = await communityOr404(ctx.params.name);
    const owner = requireModerator(ctx, community);
    if (String(community.owner_id) !== owner.id) throw errors.forbidden('Only the owner can remove moderators');
    const target = await loadMemberByUsername(ctx.params.username);
    if (!target) throw errors.notFound('Account not found');
    if (String(community.owner_id) === target.id) throw errors.conflict('The owner cannot be removed');
    const removed = await transaction(async (tx) => {
      const result = await tx.query('delete from moderators where community_id = $1 and member_id = $2', [
        community.id,
        target.id,
      ]);
      if (result.rowCount === 0) return false;
      await writeModLog(tx, {
        communityId: String(community.id),
        moderatorId: owner.id,
        action: 'remove_moderator',
        targetType: 'user',
        targetId: target.username,
        publicReason: null,
        privateNote: null,
      });
      return true;
    });
    if (!removed) throw errors.conflict('They are not a moderator');
    await emitAccount(target.id, 'moderator-removed', community.name);
    sendNoContent(ctx);
  }),

  route(
    'GET',
    '/api/communities/:name/approved',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      requireModerator(ctx, community);
      sendJson(ctx, 200, { items: await listApprovedPosters(String(community.id)) });
    },
    'none',
  ),

  route('PUT', '/api/communities/:name/approved/:username', async (ctx) => {
    const community = await communityOr404(ctx.params.name);
    const moderator = requireModerator(ctx, community);
    const target = await loadMemberByUsername(ctx.params.username);
    if (!target) throw errors.notFound('Account not found');
    const added = await transaction(async (tx) => {
      const result = await tx.query(
        'insert into approved_posters (community_id, member_id) values ($1, $2) on conflict do nothing',
        [community.id, target.id],
      );
      if (result.rowCount === 0) return false;
      await writeModLog(tx, {
        communityId: String(community.id),
        moderatorId: moderator.id,
        action: 'approve_poster',
        targetType: 'user',
        targetId: target.username,
        publicReason: null,
        privateNote: null,
      });
      return true;
    });
    if (added) await emitAccount(target.id, 'approved', community.name);
    sendJson(ctx, 200, { username: target.username, approved: true });
  }),

  route('DELETE', '/api/communities/:name/approved/:username', async (ctx) => {
    const community = await communityOr404(ctx.params.name);
    const moderator = requireModerator(ctx, community);
    const target = await loadMemberByUsername(ctx.params.username);
    if (!target) throw errors.notFound('Account not found');
    const removed = await transaction(async (tx) => {
      const result = await tx.query('delete from approved_posters where community_id = $1 and member_id = $2', [
        community.id,
        target.id,
      ]);
      if (result.rowCount === 0) return false;
      await writeModLog(tx, {
        communityId: String(community.id),
        moderatorId: moderator.id,
        action: 'unapprove_poster',
        targetType: 'user',
        targetId: target.username,
        publicReason: null,
        privateNote: null,
      });
      return true;
    });
    if (removed) await emitAccount(target.id, 'unapproved', community.name);
    sendJson(ctx, 200, { username: target.username, approved: false });
  }),

  route(
    'GET',
    '/api/communities/:name/posts',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      const sort = parseSort(ctx.url.searchParams.get('sort'), ['hot', 'new', 'top'] as const, 'hot');
      const cursor = ctx.url.searchParams.get('cursor');
      const viewerId = ctx.viewer.member ? ctx.viewer.member.id : null;
      const page = await feedPage({
        sort,
        cursor,
        viewerId,
        scope: { kind: 'community', communityId: String(community.id) },
      });
      const pinned = cursor ? [] : await pinnedPosts(String(community.id), viewerId);
      sendJson(ctx, 200, {
        pinned: await projectPosts(pinned, ctx.viewer),
        items: await projectPosts(page.rows, ctx.viewer),
        nextCursor: page.nextCursor,
      });
    },
    'none',
  ),

  route(
    'GET',
    '/api/communities/:name/modlog',
    async (ctx) => {
      const community = await communityOr404(ctx.params.name);
      const page = await modLogPage(String(community.id), ctx.url.searchParams.get('cursor'));
      const view = modLogView(ctx.viewer, community);
      sendJson(ctx, 200, {
        items: page.rows.map((row) => modLogProjection(row, view)),
        nextCursor: page.nextCursor,
      });
    },
    'none',
  ),
];
