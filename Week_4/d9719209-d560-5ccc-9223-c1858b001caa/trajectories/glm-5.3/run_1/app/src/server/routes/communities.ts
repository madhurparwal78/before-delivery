/* Community endpoints: listing, creation, membership, moderators, approved
   posters, rules, and the mod log. */
import { ApiError, validation } from '../errors.js';
import { route, type Route, type RouteHandler, type Services } from '../routes.js';
import type { Ctx } from '../context.js';
import { isCommunityName, isUsername, iso } from '../util.js';

const RESERVED = new Set(['admin', 'api', 'mod', 'mods', 'moothall', 'all', 'popular', 'home', 'settings', 'about', 'u', 'c', 'new', 'help', 'login', 'signup', 'media']);

type CommunityRow = {
  id: string;
  name: string;
  title: string;
  description: string;
  type: string;
  member_count: number;
  show_mod_names: boolean;
  created_at: Date;
};

export function registerCommunityRoutes(services: Services, add: (r: Route) => void): void {
  add(route('GET', '/api/communities', listCommunities(services), 'none'));
  add(route('GET', '/api/communities/mine', myCommunities(services), 'none'));
  add(route('POST', '/api/communities', createCommunity(services)));
  add(route('GET', '/api/communities/:name', getCommunity(services), 'none'));
  add(route('PATCH', '/api/communities/:name', patchCommunity(services)));
  add(route('PUT', '/api/communities/:name/rules', putRules(services)));
  add(route('PUT', '/api/communities/:name/membership', join(services), 'none'));
  add(route('DELETE', '/api/communities/:name/membership', leave(services), 'none'));
  add(route('GET', '/api/communities/:name/moderators', listModerators(services), 'none'));
  add(route('POST', '/api/communities/:name/moderators', addModerator(services)));
  add(route('DELETE', '/api/communities/:name/moderators/:username', removeModerator(services)));
  add(route('GET', '/api/communities/:name/approved', listApproved(services), 'none'));
  add(route('PUT', '/api/communities/:name/approved/:username', approvePoster(services), 'none'));
  add(route('DELETE', '/api/communities/:name/approved/:username', unapprovePoster(services), 'none'));
  add(route('GET', '/api/communities/:name/modlog', modLog(services), 'none'));
}

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function loadCommunity(services: Services, name: string): Promise<CommunityRow> {
  const rows = await services.db.query(`SELECT * FROM communities WHERE name_lc = $1`, [name.toLowerCase()]);
  if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
  return rows.rows[0] as unknown as CommunityRow;
}

export async function viewerState(services: Services, communityId: string, account: Ctx['account']): Promise<{ joined: boolean; isModerator: boolean; isOwner: boolean; canPost: boolean }> {
  if (account === null) return { joined: false, isModerator: false, isOwner: false, canPost: false };
  const rows = await services.db.query(
    `SELECT
       (SELECT count(*)::int FROM memberships WHERE community_id = $1 AND account_id = $2) AS joined,
       (SELECT count(*)::int FROM moderators WHERE community_id = $1 AND account_id = $2) AS is_mod,
       (SELECT count(*)::int FROM moderators WHERE community_id = $1 AND account_id = $2 AND is_owner) AS is_owner`,
    [communityId, account.id]
  );
  const r = rows.rows[0] as { joined: number; is_mod: number; is_owner: number };
  const isModerator = r.is_mod > 0;
  return { joined: r.joined > 0, isModerator, isOwner: r.is_owner > 0, canPost: isModerator };
}

function communityView(c: CommunityRow, rules: { id: string; title: string; description: string }[], viewer: { joined: boolean; isModerator: boolean; isOwner: boolean; canPost: boolean }): unknown {
  return {
    id: Number(c.id),
    name: c.name,
    title: c.title,
    description: c.description,
    type: c.type === 'restricted' ? 'restricted' : 'public',
    memberCount: c.member_count,
    rules: rules.map((r) => ({ id: Number(r.id), title: r.title, description: r.description })),
    showModNames: c.show_mod_names,
    createdAt: iso(new Date(c.created_at)),
    viewer,
  };
}

async function loadRules(services: Services, communityId: string): Promise<{ id: string; title: string; description: string }[]> {
  const rows = await services.db.query(
    `SELECT id, title, description FROM rules WHERE community_id = $1 ORDER BY position, id`,
    [communityId]
  );
  return rows.rows as unknown as { id: string; title: string; description: string }[];
}

function listCommunities(services: Services): RouteHandler {
  return async (ctx) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    const cursor = ctx.url.searchParams.get('cursor');
    const params: unknown[] = [q.toLowerCase() + '%'];
    let where = `WHERE name_lc LIKE $1`;
    let offset = 0;
    if (cursor !== null) {
      offset = Number(cursor);
      if (!Number.isInteger(offset) || offset < 0) throw validation({ cursor: 'This cursor is not valid' });
    }
    params.push(offset);
    const rows = await services.db.query(
      `SELECT * FROM communities ${where} ORDER BY member_count DESC, name_lc ASC LIMIT 26 OFFSET $2`,
      params
    );
    const items: unknown[] = [];
    for (const c of rows.rows as unknown as CommunityRow[]) {
      const rules = await loadRules(services, c.id);
      const viewer = await viewerState(services, c.id, ctx.account);
      items.push(communityView(c, rules, { ...viewer, canPost: viewer.canPost }));
    }
    return {
      status: 200,
      body: { items, nextCursor: rows.rows.length > 25 ? String(offset + 25) : null },
    };
  };
}

function myCommunities(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const rows = await services.db.query(
      `SELECT c.* FROM communities c JOIN memberships m ON m.community_id = c.id WHERE m.account_id = $1 ORDER BY c.name_lc`,
      [ctx.account.id]
    );
    const items: unknown[] = [];
    for (const c of rows.rows as unknown as CommunityRow[]) {
      const rules = await loadRules(services, c.id);
      const viewer = await viewerState(services, c.id, ctx.account);
      items.push(communityView(c, rules, { ...viewer, canPost: viewer.isModerator }));
    }
    return { status: 200, body: { items } };
  };
}

function createCommunity(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const account = ctx.account;
    if (!account.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', 'Verify your email to create a community');
    const b = body(ctx);
    const name = str(b.name).trim();
    const title = str(b.title).trim();
    const description = str(b.description);
    const type = str(b.type);
    const fields: Record<string, string> = {};
    if (!isCommunityName(name)) fields.name = 'Names are 3 to 21 letters, digits or underscores';
    if (title.length < 1 || title.length > 100) fields.title = 'Titles are 1 to 100 characters';
    if (description.length > 500) fields.description = 'Descriptions are at most 500 characters';
    if (type !== 'public' && type !== 'restricted') fields.type = 'Type must be Public or Restricted';
    if (Object.keys(fields).length > 0) throw new ApiError('VALIDATION', 'Check the fields', { fields });

    const nameLc = name.toLowerCase();
    if (RESERVED.has(nameLc)) throw new ApiError('RESERVED', 'That name is reserved', { fields: { name: 'That name is reserved' } });
    const exists = await services.db.query(`SELECT 1 FROM communities WHERE name_lc = $1`, [nameLc]);
    if (exists.rows.length > 0) throw new ApiError('NAME_TAKEN', 'That name is taken', { fields: { name: 'That name is taken' } });

    // Account age and owned-community limit (NOT_ELIGIBLE refusals)
    const ageDays = (Date.now() - account.createdAt.getTime()) / 86_400_000;
    if (ageDays < services.cfg.limits.communityMinAccountAgeDays) {
      throw new ApiError('NOT_ELIGIBLE', `Accounts can create communities once they are ${services.cfg.limits.communityMinAccountAgeDays} days old`);
    }
    const owned = await services.db.query(`SELECT count(*)::int AS n FROM moderators WHERE account_id = $1 AND is_owner`, [account.id]);
    if ((owned.rows[0] as { n: number }).n >= 5) {
      throw new ApiError('NOT_ELIGIBLE', 'You already own 5 communities');
    }

    const inserted = await services.db.query(
      `INSERT INTO communities (name, name_lc, title, description, type, member_count) VALUES ($1,$2,$3,$4,$5,0) RETURNING *`,
      [name, nameLc, title, description, type]
    );
    const c = inserted.rows[0] as unknown as CommunityRow;
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`INSERT INTO memberships (community_id, account_id) VALUES ($1,$2)`, [Number(c.id), account.id]);
      await services.db.query(`INSERT INTO moderators (community_id, account_id, is_owner) VALUES ($1,$2,true)`, [Number(c.id), account.id]);
      await services.db.query(`UPDATE communities SET member_count = 1 WHERE id = $1`, [Number(c.id)]);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    const rules = await loadRules(services, c.id);
    return { status: 201, body: communityView({ ...c, member_count: 1 }, rules, { joined: true, isModerator: true, isOwner: true, canPost: true }) };
  };
}

function getCommunity(services: Services): RouteHandler {
  return async (ctx) => {
    const c = await loadCommunity(services, ctx.params.name as string);
    const rules = await loadRules(services, c.id);
    const viewer = await viewerState(services, c.id, ctx.account);
    let canPost = viewer.isModerator;
    if (c.type !== 'restricted') canPost = true;
    else {
      if (ctx.account !== null) {
        const approved = await services.db.query(
          `SELECT 1 FROM approved_posters WHERE community_id = $1 AND account_id = $2`,
          [c.id, ctx.account.id]
        );
        if (approved.rows.length > 0) canPost = true;
      }
    }
    return { status: 200, body: communityView(c, rules, { ...viewer, canPost }) };
  };
}

function patchCommunity(services: Services): RouteHandler {
  return async (ctx) => {
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    if (!viewer.isModerator) throw new ApiError('FORBIDDEN', 'Moderators only');
    const b = body(ctx);
    const title = b.title;
    const description = b.description;
    const showModNames = b.showModNames;
    const fields: Record<string, string> = {};
    if (title !== undefined && (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 100)) {
      fields.title = 'Titles are 1 to 100 characters';
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
      fields.description = 'Descriptions are at most 500 characters';
    }
    if (showModNames !== undefined && typeof showModNames !== 'boolean') fields.showModNames = 'Show moderator names must be a boolean';
    if (Object.keys(fields).length > 0) throw new ApiError('VALIDATION', 'Check the fields', { fields });
    if (title !== undefined) await services.db.query(`UPDATE communities SET title = $2 WHERE id = $1`, [Number(c.id), (title as string).trim()]);
    if (description !== undefined) await services.db.query(`UPDATE communities SET description = $2 WHERE id = $1`, [Number(c.id), description as string]);
    if (showModNames !== undefined) await services.db.query(`UPDATE communities SET show_mod_names = $2 WHERE id = $1`, [Number(c.id), showModNames as boolean]);
    const fresh = await loadCommunity(services, c.name);
    const rules = await loadRules(services, fresh.id);
    return { status: 200, body: communityView(fresh, rules, await viewerState(services, fresh.id, ctx.account)) };
  };
}

function putRules(services: Services): RouteHandler {
  return async (ctx) => {
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    if (!viewer.isModerator) throw new ApiError('FORBIDDEN', 'Moderators only');
    const raw = body(ctx).rules;
    if (!Array.isArray(raw) || raw.length > 15) {
      throw new ApiError('VALIDATION', 'Check the fields', { fields: { rules: 'There can be at most 15 rules' } });
    }
    const fields: Record<string, string> = {};
    const parsed: { title: string; description: string }[] = [];
    for (const r of raw) {
      const rec = r as Record<string, unknown>;
      const title = str(rec.title).trim();
      const description = str(rec.description);
      if (title.length < 1 || title.length > 100) fields.rules = 'Rule titles are 1 to 100 characters';
      if (description.length > 500) fields.rules = 'Rule descriptions are at most 500 characters';
      parsed.push({ title, description });
    }
    if (Object.keys(fields).length > 0) throw new ApiError('VALIDATION', 'Check the fields', { fields });
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`DELETE FROM rules WHERE community_id = $1`, [Number(c.id)]);
      for (let i = 0; i < parsed.length; i++) {
        const r = parsed[i] as { title: string; description: string };
        await services.db.query(`INSERT INTO rules (community_id, position, title, description) VALUES ($1,$2,$3,$4)`, [Number(c.id), i, r.title, r.description]);
      }
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    const fresh = await loadCommunity(services, c.name);
    const rules = await loadRules(services, fresh.id);
    return { status: 200, body: communityView(fresh, rules, await viewerState(services, fresh.id, ctx.account)) };
  };
}

function join(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const c = await loadCommunity(services, ctx.params.name as string);
    const existing = await services.db.query(
      `SELECT 1 FROM memberships WHERE community_id = $1 AND account_id = $2`,
      [c.id, ctx.account.id]
    );
    if (existing.rows.length > 0) {
      return { status: 200, body: { joined: true, memberCount: c.member_count } };
    }
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`INSERT INTO memberships (community_id, account_id) VALUES ($1,$2)`, [Number(c.id), ctx.account.id]);
      const updated = await services.db.query(`UPDATE communities SET member_count = member_count + 1 WHERE id = $1 RETURNING member_count`, [Number(c.id)]);
      const count = (updated.rows[0] as { member_count: number }).member_count;
      await services.db.query(`COMMIT`);
      void services.valkey.publish({ topics: [`community:${c.name.toLowerCase()}`, 'home'], event: 'membership', data: { communityName: c.name, memberCount: count } });
      return { status: 200, body: { joined: true, memberCount: count } };
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
  };
}

function leave(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    if (viewer.isOwner) throw new ApiError('CONFLICT', 'The owner cannot leave their community');
    const existing = await services.db.query(
      `SELECT 1 FROM memberships WHERE community_id = $1 AND account_id = $2`,
      [c.id, ctx.account.id]
    );
    if (existing.rows.length === 0) {
      return { status: 200, body: { joined: false, memberCount: c.member_count } };
    }
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`DELETE FROM memberships WHERE community_id = $1 AND account_id = $2`, [Number(c.id), ctx.account.id]);
      const updated = await services.db.query(`UPDATE communities SET member_count = member_count - 1 WHERE id = $1 RETURNING member_count`, [Number(c.id)]);
      const count = (updated.rows[0] as { member_count: number }).member_count;
      await services.db.query(`COMMIT`);
      void services.valkey.publish({ topics: [`community:${c.name.toLowerCase()}`, 'home'], event: 'membership', data: { communityName: c.name, memberCount: count } });
      return { status: 200, body: { joined: false, memberCount: count } };
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
  };
}

function listModerators(services: Services): RouteHandler {
  return async (ctx) => {
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    if (!viewer.isModerator) throw new ApiError('FORBIDDEN', 'Moderators only');
    const rows = await services.db.query(
      `SELECT a.username, m.is_owner FROM moderators m JOIN accounts a ON a.id = m.account_id WHERE m.community_id = $1 ORDER BY m.is_owner DESC, a.username_lc`,
      [c.id]
    );
    return { status: 200, body: { items: rows.rows.map((r) => ({ username: (r as { username: string }).username, isOwner: (r as { is_owner: boolean }).is_owner })) } };
  };
}

function addModerator(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    if (!viewer.isOwner) throw new ApiError('FORBIDDEN', 'The owner adds moderators');
    const username = str(body(ctx).username).trim();
    const userRows = await services.db.query(`SELECT id, username FROM accounts WHERE username_lc = $1`, [username.toLowerCase()]);
    if (userRows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Unknown user');
    const user = userRows.rows[0] as { id: string; username: string };
    const already = await services.db.query(`SELECT 1 FROM moderators WHERE community_id = $1 AND account_id = $2`, [c.id, user.id]);
    if (already.rows.length > 0) throw new ApiError('CONFLICT', 'Already a moderator');
    await services.db.query(`INSERT INTO moderators (community_id, account_id, is_owner) VALUES ($1,$2,false)`, [Number(c.id), Number(user.id)]);
    const accountEvent = { kind: 'approved', communityName: c.name };
    void accountEvent;
    return { status: 201, body: { username: user.username, isOwner: false } };
  };
}

function removeModerator(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    if (!viewer.isOwner) throw new ApiError('FORBIDDEN', 'The owner removes moderators');
    const username = ctx.params.username as string;
    const userRows = await services.db.query(`SELECT id, username FROM accounts WHERE username_lc = $1`, [username.toLowerCase()]);
    if (userRows.rows.length === 0) throw new ApiError('CONFLICT', 'Not a moderator');
    const user = userRows.rows[0] as { id: string; username: string };
    const modRows = await services.db.query(`SELECT is_owner FROM moderators WHERE community_id = $1 AND account_id = $2`, [c.id, user.id]);
    if (modRows.rows.length === 0) throw new ApiError('CONFLICT', 'Not a moderator');
    if ((modRows.rows[0] as { is_owner: boolean }).is_owner) throw new ApiError('CONFLICT', 'The owner cannot be removed');
    await services.db.query(`DELETE FROM moderators WHERE community_id = $1 AND account_id = $2`, [Number(c.id), Number(user.id)]);
    void services.valkey.publish({ topics: [`account:${Number(user.id)}`], event: 'account', data: { kind: 'moderator-removed', communityName: c.name, accountId: Number(user.id) } });
    return { status: 204, body: undefined };
  };
}

function listApproved(services: Services): RouteHandler {
  return async (ctx) => {
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    if (!viewer.isModerator) throw new ApiError('FORBIDDEN', 'Moderators only');
    const rows = await services.db.query(
      `SELECT a.username FROM approved_posters p JOIN accounts a ON a.id = p.account_id WHERE p.community_id = $1 ORDER BY a.username_lc`,
      [c.id]
    );
    return { status: 200, body: { items: rows.rows.map((r) => ({ username: (r as { username: string }).username })) } };
  };
}

function approvePoster(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    if (!viewer.isModerator) throw new ApiError('FORBIDDEN', 'Moderators only');
    const username = ctx.params.username as string;
    const userRows = await services.db.query(`SELECT id, username FROM accounts WHERE username_lc = $1`, [username.toLowerCase()]);
    if (userRows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Unknown user');
    const user = userRows.rows[0] as { id: string; username: string };
    await services.db.query(
      `INSERT INTO approved_posters (community_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [Number(c.id), Number(user.id)]
    );
    void services.valkey.publish({ topics: [`account:${Number(user.id)}`], event: 'account', data: { kind: 'approved', communityName: c.name, accountId: Number(user.id) } });
    return { status: 200, body: { username: user.username, approved: true } };
  };
}

function unapprovePoster(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    if (!viewer.isModerator) throw new ApiError('FORBIDDEN', 'Moderators only');
    const username = ctx.params.username as string;
    const userRows = await services.db.query(`SELECT id, username FROM accounts WHERE username_lc = $1`, [username.toLowerCase()]);
    if (userRows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Unknown user');
    const user = userRows.rows[0] as { id: string; username: string };
    await services.db.query(`DELETE FROM approved_posters WHERE community_id = $1 AND account_id = $2`, [Number(c.id), Number(user.id)]);
    void services.valkey.publish({ topics: [`account:${Number(user.id)}`], event: 'account', data: { kind: 'unapproved', communityName: c.name, accountId: Number(user.id) } });
    return { status: 200, body: { username: user.username, approved: false } };
  };
}

function modLog(services: Services): RouteHandler {
  return async (ctx) => {
    const c = await loadCommunity(services, ctx.params.name as string);
    const viewer = await viewerState(services, c.id, ctx.account);
    const cursor = ctx.url.searchParams.get('cursor');
    let offset = 0;
    if (cursor !== null) {
      offset = Number(cursor);
      if (!Number.isInteger(offset) || offset < 0) throw validation({ cursor: 'This cursor is not valid' });
    }
    const rows = await services.db.query(
      `SELECT l.id, l.action, l.target_type, l.target_id, l.target_label, l.public_reason, l.private_note, l.at, a.username AS moderator
       FROM mod_log l LEFT JOIN accounts a ON a.id = l.moderator_id
       WHERE l.community_id = $1 ORDER BY l.id DESC LIMIT 26 OFFSET $2`,
      [c.id, offset]
    );
    const items = (rows.rows as unknown as ModLogRow[]).slice(0, 25).map((r) => modLogView(r, viewer.isModerator, c.show_mod_names));
    return { status: 200, body: { items, nextCursor: rows.rows.length > 25 ? String(offset + 25) : null } };
  };
}

export type ModLogRow = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  target_label: string;
  public_reason: string | null;
  private_note: string | null;
  at: Date;
  moderator: string | null;
};

export function modLogView(r: ModLogRow, isModerator: boolean, showModNames: boolean): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: Number(r.id),
    action: r.action,
    target: { type: r.target_type, id: r.target_id },
    publicReason: r.public_reason,
    at: iso(new Date(r.at)),
  };
  const mod = isModerator || showModNames ? r.moderator : null;
  view.moderator = mod === null ? null : { username: mod };
  if (isModerator) view.privateNote = r.private_note;
  return view;
}
