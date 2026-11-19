import { pool, one, rows, tx, isUniqueViolation } from '../db.js';
import { config } from '../config.js';
import { now } from '../clock.js';
import { AppError, conflict, notFound, validation } from '../errors.js';
import { ok, created, noContent, route, type Ctx, type Reply } from '../http.js';
import { requireModerator, requireUser, requireVerified, optionalUser } from '../guards.js';
import { communityRef, requireOwner } from '../community.js';
import { feedPage } from '../feed.js';
import { loadCommunities, loadCommunity, loadPosts, modLogView } from '../views.js';
import { insertCommunity, replaceRules, setMembership } from '../writes.js';
import { logAction } from '../modlog.js';
import { emitAccount, emitMembership } from '../events.js';
import { decodeIdCursor, encodeIdCursor, PAGE_SIZE } from '../cursor.js';
import { findUserByUsername } from '../accounts.js';
import {
  COPY, asRecord, asString, failIfAny, isValidCommunityName, isWithin, type Fields,
} from '../validate.js';
import type { CommunityView } from '../../shared/types.js';

const RESERVED_NAMES = new Set([
  'admin', 'api', 'mod', 'mods', 'moothall', 'all', 'popular', 'home', 'settings', 'about', 'u', 'c', 'new', 'help',
  'login', 'signup', 'media',
]);
const OWNED_LIMIT = 5;
const MAX_RULES = 15;

const nameParam = (ctx: Ctx): string => ctx.params.name as string;

async function viewOrThrow(ctx: Ctx): Promise<CommunityView> {
  const community = await loadCommunity(pool, optionalUser(ctx), nameParam(ctx));
  if (!community) throw notFound('No such community');
  return community;
}

async function list(ctx: Ctx): Promise<Reply> {
  const viewer = optionalUser(ctx);
  const prefix = ctx.query.get('q') ?? '';
  const cursor = decodeCommunityCursor(ctx.query.get('cursor'));
  const found = await loadCommunities(pool, viewer,
    `($2 = '' OR starts_with(c.name_key, lower($2)))
     AND ($3::int IS NULL OR c.member_count < $3 OR (c.member_count = $3 AND c.name_key > $4))`,
    [prefix, cursor?.count ?? null, cursor?.key ?? ''],
    `ORDER BY c.member_count DESC, c.name_key ASC LIMIT ${PAGE_SIZE + 1}`);
  const items = found.slice(0, PAGE_SIZE);
  const last = items[PAGE_SIZE - 1];
  const nextCursor = found.length > PAGE_SIZE && last
    ? Buffer.from(`${last.memberCount}|${last.name.toLowerCase()}`).toString('base64url') : null;
  return ok({ items, nextCursor });
}

function decodeCommunityCursor(cursor: string | null): { count: number; key: string } | null {
  if (cursor === null) return null;
  const [count, key] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!cursor.match(/^[A-Za-z0-9_-]+$/) || !/^\d+$/.test(count ?? '') || !key) throw validation({ cursor: 'This cursor is not valid' });
  return { count: Number(count), key };
}

async function mine(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const items = await loadCommunities(pool, user,
    'EXISTS (SELECT 1 FROM memberships m WHERE m.community_id = c.id AND m.user_id = $1::bigint)', [], 'ORDER BY c.name_key');
  return ok({ items });
}

function communityFields(input: Record<string, unknown>): Fields {
  const fields: Fields = {};
  const title = asString(input.title)?.trim() ?? '';
  const description = asString(input.description) ?? '';
  if (!isWithin(title, 1, 100)) fields.title = COPY.communityTitle;
  if (!isWithin(description, 0, 500)) fields.description = COPY.communityDescription;
  return fields;
}

async function create(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  requireVerified(user);
  const input = asRecord(ctx.body);
  const name = asString(input.name) ?? '';
  const ageDays = (now().getTime() - user.createdAt.getTime()) / 86_400_000;
  await tx(async (client) => {
    await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    const owned = await one<{ owned: number }>(client, 'SELECT count(*)::int AS owned FROM communities WHERE owner_id = $1', [user.id]);
    if (ageDays < config.limits.communityMinAccountAgeDays) {
      throw new AppError('NOT_ELIGIBLE', `Accounts can create communities once they are ${config.limits.communityMinAccountAgeDays} days old`);
    }
    if ((owned?.owned ?? 0) >= OWNED_LIMIT) throw new AppError('NOT_ELIGIBLE', `You already own ${OWNED_LIMIT} communities`);
    if (isValidCommunityName(name)) {
      if (RESERVED_NAMES.has(name.toLowerCase())) {
        throw new AppError('RESERVED', 'That name is reserved', { fields: { name: COPY.communityReserved } });
      }
      const taken = await one(client, 'SELECT 1 FROM communities WHERE name_key = lower($1)', [name]);
      if (taken) throw new AppError('NAME_TAKEN', 'That name is taken', { fields: { name: COPY.communityTaken } });
    }
    const fields = communityFields(input);
    const type = asString(input.type);
    if (!isValidCommunityName(name)) fields.name = COPY.communityName;
    if (type !== 'public' && type !== 'restricted') fields.type = COPY.communityType;
    failIfAny(fields);
    await insertCommunity(client, {
      name, title: (asString(input.title) as string).trim(), description: asString(input.description) ?? '',
      type: type as 'public' | 'restricted', ownerId: user.id, rules: [], moderatorIds: [user.id], memberIds: [user.id], memberCount: 1,
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new AppError('NAME_TAKEN', 'That name is taken', { fields: { name: COPY.communityTaken } });
      throw error;
    });
  });
  const made = await loadCommunity(pool, user, name);
  if (!made) throw notFound('No such community');
  return created(made);
}

async function patch(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  await requireModerator(pool, user, community);
  const input = asRecord(ctx.body);
  const fields: Fields = {};
  if ('title' in input && !isWithin(asString(input.title)?.trim() ?? '', 1, 100)) fields.title = COPY.communityTitle;
  if ('description' in input) {
    const description = asString(input.description);
    if (description === undefined || description.length > 500) fields.description = COPY.communityDescription;
  }
  if ('showModNames' in input && typeof input.showModNames !== 'boolean') fields.showModNames = 'Choose on or off';
  failIfAny(fields);
  await pool.query(
    `UPDATE communities SET title = COALESCE($2, title), description = COALESCE($3, description),
       show_mod_names = COALESCE($4, show_mod_names) WHERE id = $1`,
    [community.id, 'title' in input ? (input.title as string).trim() : null, 'description' in input ? input.description : null,
      'showModNames' in input ? input.showModNames : null]);
  return ok(await viewOrThrow(ctx));
}

async function putRules(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  await requireModerator(pool, user, community);
  const raw = asRecord(ctx.body).rules;
  const rules = Array.isArray(raw) ? raw.map(asRecord) : null;
  const valid = rules !== null && rules.length <= MAX_RULES && rules.every((r) =>
    isWithin(asString(r.title)?.trim() ?? '', 1, 100) && isWithin(asString(r.description) ?? '', 0, 500));
  if (!valid) throw validation({ rules: COPY.rules });
  await tx((client) => replaceRules(client, community.id, (rules as Record<string, unknown>[]).map((r) => ({
    title: (r.title as string).trim(), description: asString(r.description) ?? '',
  }))));
  return ok(await viewOrThrow(ctx));
}

async function membership(ctx: Ctx, joined: boolean): Promise<Reply> {
  const user = requireUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  if (!joined && community.ownerId === user.id) throw conflict('The owner cannot leave the community');
  const memberCount = await tx((client) => setMembership(client, community.id, user.id, joined));
  await emitMembership({ communityName: community.name, memberCount });
  return ok({ joined, memberCount });
}

async function listModerators(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  await requireModerator(pool, user, community);
  const items = await rows<{ username: string; is_owner: boolean }>(pool,
    `SELECT u.username, (u.id = c.owner_id) AS is_owner FROM moderators m JOIN users u ON u.id = m.user_id
     JOIN communities c ON c.id = m.community_id WHERE m.community_id = $1 ORDER BY is_owner DESC, u.username_key`, [community.id]);
  return ok({ items: items.map((i) => ({ username: i.username, isOwner: i.is_owner })) });
}

async function addModerator(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  requireOwner(user, community);
  const username = asString(asRecord(ctx.body).username) ?? '';
  const target = await findUserByUsername(pool, username);
  if (!target) throw notFound('No such member');
  await tx(async (client) => {
    const inserted = await rows(client, 'INSERT INTO moderators (community_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [community.id, target.id]);
    if (inserted.length === 0) throw conflict('Already a moderator');
    await logAction(client, { communityId: community.id, action: 'add_moderator', target: { type: 'user', id: target.username }, moderatorId: user.id });
  });
  return created({ username: target.username, isOwner: false });
}

async function removeModerator(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  requireOwner(user, community);
  const target = await findUserByUsername(pool, ctx.params.username as string);
  if (!target) throw notFound('No such member');
  if (target.id === community.ownerId) throw conflict('The owner cannot be removed');
  await tx(async (client) => {
    const removed = await rows(client, 'DELETE FROM moderators WHERE community_id = $1 AND user_id = $2 RETURNING 1', [community.id, target.id]);
    if (removed.length === 0) throw conflict('Not a moderator');
    await logAction(client, { communityId: community.id, action: 'remove_moderator', target: { type: 'user', id: target.username }, moderatorId: user.id });
  });
  await emitAccount(target.id, { kind: 'moderator-removed', communityName: community.name });
  return noContent();
}

async function listApproved(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  await requireModerator(pool, user, community);
  const items = await rows<{ username: string }>(pool,
    'SELECT u.username FROM approved_posters a JOIN users u ON u.id = a.user_id WHERE a.community_id = $1 ORDER BY u.username_key', [community.id]);
  return ok({ items });
}

async function setApproval(ctx: Ctx, approved: boolean): Promise<Reply> {
  const user = requireUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  await requireModerator(pool, user, community);
  const target = await findUserByUsername(pool, ctx.params.username as string);
  if (!target) {
    if (approved) throw notFound('No such member');
    return ok({ username: ctx.params.username as string, approved: false });
  }
  const changed = await tx(async (client) => {
    const result = approved
      ? await rows(client, 'INSERT INTO approved_posters (community_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [community.id, target.id])
      : await rows(client, 'DELETE FROM approved_posters WHERE community_id = $1 AND user_id = $2 RETURNING 1', [community.id, target.id]);
    if (result.length > 0) {
      await logAction(client, {
        communityId: community.id, action: approved ? 'approve_poster' : 'unapprove_poster',
        target: { type: 'user', id: target.username }, moderatorId: user.id,
      });
    }
    return result.length > 0;
  });
  if (changed) await emitAccount(target.id, { kind: approved ? 'approved' : 'unapproved', communityName: community.name });
  return ok({ username: target.username, approved });
}

async function communityPosts(ctx: Ctx): Promise<Reply> {
  const viewer = optionalUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  const cursor = ctx.query.get('cursor');
  const page = await feedPage(pool, viewer, ctx.query.get('sort'), cursor, 'p.community_id = $4 AND NOT p.pinned', [community.id]);
  const pinned = cursor === null
    ? await loadPosts(pool, viewer, "p.community_id = $4 AND p.pinned AND p.state = 'published'", [community.id], 'ORDER BY p.pinned_at, p.id')
    : [];
  return ok({ pinned, items: page.items, nextCursor: page.nextCursor });
}

async function modLog(ctx: Ctx): Promise<Reply> {
  const viewer = optionalUser(ctx);
  const community = await communityRef(pool, nameParam(ctx));
  const before = decodeIdCursor(ctx.query.get('cursor'));
  const moderating = viewer !== null && (await one(pool, 'SELECT 1 FROM moderators WHERE community_id = $1 AND user_id = $2', [community.id, viewer.id])) !== null;
  const showNames = (await one<{ show_mod_names: boolean }>(pool, 'SELECT show_mod_names FROM communities WHERE id = $1', [community.id]))?.show_mod_names ?? false;
  const found = await rows<Parameters<typeof modLogView>[0]>(pool,
    `SELECT l.id, l.action, l.target_type, l.target_id, l.public_reason, l.private_note, l.at,
       u.username AS moderator_username, u.created_at AS moderator_created_at
     FROM mod_log l JOIN users u ON u.id = l.moderator_id
     WHERE l.community_id = $1 AND ($2::bigint IS NULL OR l.id < $2) ORDER BY l.id DESC LIMIT ${PAGE_SIZE + 1}`,
    [community.id, before]);
  const items = found.slice(0, PAGE_SIZE).map((row) => modLogView(row, showNames, moderating));
  const last = items[PAGE_SIZE - 1];
  return ok({ items, nextCursor: found.length > PAGE_SIZE && last ? encodeIdCursor(last.id) : null });
}

export function registerCommunityRoutes(): void {
  route('GET', '/api/communities', list);
  route('GET', '/api/communities/mine', mine);
  route('POST', '/api/communities', create);
  route('GET', '/api/communities/:name', async (ctx) => ok(await viewOrThrow(ctx)));
  route('PATCH', '/api/communities/:name', patch);
  route('PUT', '/api/communities/:name/rules', putRules);
  route('PUT', '/api/communities/:name/membership', (ctx) => membership(ctx, true));
  route('DELETE', '/api/communities/:name/membership', (ctx) => membership(ctx, false));
  route('GET', '/api/communities/:name/moderators', listModerators);
  route('POST', '/api/communities/:name/moderators', addModerator);
  route('DELETE', '/api/communities/:name/moderators/:username', removeModerator);
  route('GET', '/api/communities/:name/approved', listApproved);
  route('PUT', '/api/communities/:name/approved/:username', (ctx) => setApproval(ctx, true));
  route('DELETE', '/api/communities/:name/approved/:username', (ctx) => setApproval(ctx, false));
  route('GET', '/api/communities/:name/posts', communityPosts);
  route('GET', '/api/communities/:name/modlog', modLog);
}
