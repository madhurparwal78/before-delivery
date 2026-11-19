/**
 * Challenges, clubs, the member directory, the ladder, notifications and
 * blocking.
 */

import express from 'express';
import crypto from 'node:crypto';
import { pool, query, one, rows, newId, derivedId, transaction, UNIQUE_VIOLATION } from '../db.js';
import {
  route, fail, bodyObject, requireString, requireMember, requireOneOf, sendArray,
} from '../http.js';
import { createGame, fetchGame, gameObject, notFound } from '../games.js';
import { publicMember, avatarUrl, isValidUsername } from '../members.js';
import { applyProfilePatch, applyAvatar } from './auth.js';
import { ratingDisplay } from '../ratings.js';
import { encodeCursor, decodeCursor, pageLimit } from '../security.js';
import { START_FEN } from '../chess.js';

export const router = express.Router();

async function memberByUsername(username) {
  if (typeof username !== 'string' || username.length > 40) return null;
  return one('select * from members where lower(username) = lower($1)', [username]);
}

async function clubBySlug(slug) {
  if (typeof slug !== 'string' || slug.length > 60) return null;
  return one('select * from clubs where slug = $1', [slug]);
}

async function membershipOf(clubId, memberId) {
  return one('select * from club_memberships where club_id = $1 and member_id = $2', [clubId, memberId]);
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

function challengeShape(row, callerId) {
  const outgoing = row.from_id === callerId;
  return {
    id: row.id,
    challenge_id: row.id,
    direction: outgoing ? 'sent' : 'received',
    from: row.from_username,
    to: row.to_username,
    opponent: outgoing ? row.to_username : row.from_username,
    opponent_avatar_url: avatarUrl({
      id: outgoing ? row.to_id : row.from_id,
      avatar_key: outgoing ? row.to_avatar : row.from_avatar,
    }),
    opponent_rating_display: ratingDisplay(
      outgoing ? row.to_rating : row.from_rating,
      outgoing ? row.to_rated_games : row.from_rated_games,
    ),
    rated: row.rated,
    colour: row.colour,
    club: row.club_slug || null,
    club_name: row.club_name || null,
    status: row.status,
    created_at: row.created_at,
  };
}

export async function challengesFor(memberId) {
  const result = await query(
    `select c.*, f.username as from_username, t.username as to_username,
            f.avatar_key as from_avatar, t.avatar_key as to_avatar,
            f.rating as from_rating, t.rating as to_rating,
            f.rated_games as from_rated_games, t.rated_games as to_rated_games,
            cl.slug as club_slug, cl.name as club_name
       from challenges c
       join members f on f.id = c.from_id
       join members t on t.id = c.to_id
       left join clubs cl on cl.id = c.club_id
      where (c.from_id = $1 or c.to_id = $1) and c.status = 'pending'
      order by c.created_at desc`,
    [memberId],
  );
  return result.rows.map((row) => challengeShape(row, memberId));
}

router.get('/challenges', route(async (req, res) => {
  const member = requireMember(req);
  sendArray(res, await challengesFor(member.id));
}));

router.post('/challenges', route(async (req, res) => {
  const member = requireMember(req);
  const body = bodyObject(req);
  const opponentName = requireString(body.opponent, 'Opponent', { max: 40 });
  const colour = requireOneOf(body.colour, ['White', 'Black', 'Random'], 'Colour');
  const rated = body.rated === undefined || body.rated === null ? true : body.rated;
  if (typeof rated !== 'boolean') fail(422, 'rated must be true or false.');

  const opponent = await memberByUsername(opponentName);
  if (!opponent) fail(404, 'There is no member by that name.');
  if (opponent.id === member.id) fail(422, 'You cannot challenge yourself.');

  const blocked = await one('select 1 from blocks where blocker_id = $1 and blocked_id = $2', [opponent.id, member.id]);
  if (blocked) fail(403, 'That member has blocked you.');

  let club = null;
  if (body.club !== undefined && body.club !== null && body.club !== '') {
    club = await clubBySlug(requireString(body.club, 'club', { max: 60 }));
    if (!club) fail(404, 'There is no club by that name.');
    const mine = await membershipOf(club.id, member.id);
    if (!mine) fail(403, 'You are not a member of that club.');
    if (mine.banned) fail(403, 'You are banned from that club.');
    const theirs = await membershipOf(club.id, opponent.id);
    if (theirs && theirs.banned) fail(403, 'That member is banned from that club.');
  }

  const row = await one(
    `insert into challenges (id, from_id, to_id, club_id, rated, colour, status)
     values ($1, $2, $3, $4, $5, $6, 'pending') returning *`,
    [newId(), member.id, opponent.id, club ? club.id : null, rated, colour],
  );
  await query(
    'insert into notifications (id, member_id, kind, game_id, actor_id) values ($1, $2, $3, null, $4)',
    [newId(), opponent.id, 'challenge', member.id],
  );
  const shaped = await challengesFor(member.id);
  res.status(201).json(shaped.find((c) => c.id === row.id) || { id: row.id, challenge_id: row.id, colour, rated });
}));

router.post('/challenges/:challenge_id/accept', route(async (req, res) => {
  const member = requireMember(req);
  const key = req.get('idempotency-key') || null;
  const challengeId = req.params.challenge_id;

  const game = await transaction(async (client) => {
    const found = await client.query('select * from challenges where id = $1 for update', [challengeId]);
    const challenge = found.rows[0];
    if (!challenge) throw notFound();
    if (challenge.to_id !== member.id) fail(403, 'Only the member challenged may accept it.');

    const gameId = derivedId(`challenge-game:${challenge.id}`);
    if (challenge.status === 'accepted') {
      const existing = await fetchGame(client, gameId);
      if (existing && key && challenge.idempotency_key === key) return existing;
      if (existing && !challenge.idempotency_key) return existing;
      fail(409, 'That challenge has already been accepted.');
    }
    if (challenge.status === 'declined') fail(409, 'That challenge was declined.');

    if (challenge.club_id) {
      const mine = await membershipOf(challenge.club_id, member.id);
      if (mine && mine.banned) fail(403, 'You are banned from that club.');
    }

    let challengerColour = challenge.colour;
    if (challengerColour === 'Random') {
      const coin = crypto.createHash('sha256').update(`colour:${challenge.id}`).digest()[0] % 2;
      challengerColour = coin === 0 ? 'White' : 'Black';
    }
    const whiteId = challengerColour === 'White' ? challenge.from_id : challenge.to_id;
    const blackId = challengerColour === 'White' ? challenge.to_id : challenge.from_id;

    const created = await createGame(client, {
      id: gameId,
      whiteId,
      blackId,
      clubId: challenge.club_id,
      rated: challenge.rated,
      startFen: START_FEN,
    });
    try {
      await client.query(
        `update challenges set status = 'accepted', idempotency_key = $2 where id = $1`,
        [challenge.id, key],
      );
    } catch (error) {
      if (error.code === UNIQUE_VIOLATION) fail(409, 'That idempotency key has already been used.');
      throw error;
    }
    return created;
  });

  res.status(201).json(await gameObject(pool, game));
}));

router.post('/challenges/:challenge_id/decline', route(async (req, res) => {
  const member = requireMember(req);
  const row = await transaction(async (client) => {
    const found = await client.query('select * from challenges where id = $1 for update', [req.params.challenge_id]);
    const challenge = found.rows[0];
    if (!challenge) throw notFound();
    if (challenge.to_id !== member.id) fail(403, 'Only the member challenged may decline it.');
    if (challenge.status !== 'pending') fail(409, 'That challenge has already been answered.');
    const updated = await client.query(
      `update challenges set status = 'declined' where id = $1 returning *`,
      [challenge.id],
    );
    return updated.rows[0];
  });
  res.json({ id: row.id, challenge_id: row.id, status: row.status });
}));

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

export async function clubsVisibleTo(memberId) {
  const result = await query(
    `select c.*, 
            (select count(*)::int from club_memberships cm where cm.club_id = c.id) as member_count,
            (select cm.role from club_memberships cm where cm.club_id = c.id and cm.member_id = $1) as my_role,
            (select cm.banned from club_memberships cm where cm.club_id = c.id and cm.member_id = $1) as my_ban
       from clubs c
      where c.private = false
         or exists (select 1 from club_memberships cm where cm.club_id = c.id and cm.member_id = $1)
      order by c.private asc, c.name asc`,
    [memberId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    private: row.private,
    member_count: row.member_count,
    my_role: row.my_role || null,
    banned: Boolean(row.my_ban),
  }));
}

router.get('/clubs', route(async (req, res) => {
  const member = requireMember(req);
  sendArray(res, await clubsVisibleTo(member.id));
}));

export async function clubDetail(memberId, slug) {
  const club = await clubBySlug(slug);
  if (!club) return null;
  if (club.private) {
    const mine = await membershipOf(club.id, memberId);
    if (!mine) return null;
  }
  const roster = await rows(
    `select m.id, m.username, m.rating, m.rated_games, m.avatar_key, cm.role, cm.banned
       from club_memberships cm join members m on m.id = cm.member_id
      where cm.club_id = $1
      order by case cm.role when 'owner' then 0 when 'moderator' then 1 else 2 end, lower(m.username)`,
    [club.id],
  );
  return {
    id: club.id,
    name: club.name,
    slug: club.slug,
    private: club.private,
    members: roster.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role,
      banned: row.banned,
      rating: row.rating,
      rating_display: ratingDisplay(row.rating, row.rated_games),
      avatar_url: avatarUrl(row),
    })),
  };
}

router.get('/clubs/:club_slug', route(async (req, res) => {
  const member = requireMember(req);
  const club = await clubDetail(member.id, req.params.club_slug);
  if (!club) fail(404, 'That club is not here.');
  res.json(club);
}));

// ---------------------------------------------------------------------------
// Members and the ladder
// ---------------------------------------------------------------------------

export async function directory({ q = '', limit = 50, cursor = null }) {
  const params = [];
  const clauses = [];
  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    clauses.push(`lower(m.username) like $${params.length}`);
  }
  if (cursor) {
    params.push(cursor.username);
    clauses.push(`lower(m.username) > $${params.length}`);
  }
  params.push(limit + 1);
  const result = await query(
    `select m.* from members m
      ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
      order by lower(m.username) asc limit $${params.length}`,
    params,
  );
  const page = result.rows.slice(0, limit);
  const next = result.rows.length > limit && page.length
    ? encodeCursor({ username: page[page.length - 1].username.toLowerCase() })
    : null;
  return { members: page.map(publicMember), next };
}

router.get('/members', route(async (req, res) => {
  requireMember(req);
  const limit = pageLimit(req.query.limit, 50, 100);
  const cursor = decodeCursor(req.query.cursor);
  const q = req.query.q === undefined ? '' : String(req.query.q).slice(0, 60);
  const { members, next } = await directory({ q, limit, cursor });
  sendArray(res, members, { nextCursor: next });
}));

/** Wins, losses and draws, split by the colour the member played. */
export async function recordByColour(memberId) {
  const row = await one(
    `select
       count(*) filter (where white_id = $1 and result = '1-0') as white_wins,
       count(*) filter (where white_id = $1 and result = '0-1') as white_losses,
       count(*) filter (where white_id = $1 and result = '1/2-1/2') as white_draws,
       count(*) filter (where black_id = $1 and result = '0-1') as black_wins,
       count(*) filter (where black_id = $1 and result = '1-0') as black_losses,
       count(*) filter (where black_id = $1 and result = '1/2-1/2') as black_draws
     from games
     where status = 'finished'
       and (white_id = $1 or black_id = $1)
       and (white_id is null or black_id is null or white_id <> black_id)`,
    [memberId],
  );
  const n = (value) => Number(value || 0);
  return {
    wins: { white: n(row.white_wins), black: n(row.black_wins) },
    losses: { white: n(row.white_losses), black: n(row.black_losses) },
    draws: { white: n(row.white_draws), black: n(row.black_draws) },
  };
}

router.get('/members/:username', route(async (req, res) => {
  requireMember(req);
  const member = await memberByUsername(req.params.username);
  if (!member) fail(404, 'There is no member by that name.');
  const record = await recordByColour(member.id);
  res.json({ ...publicMember(member), ...record });
}));

/** A member's finished games, newest first. */
export async function finishedGames(memberId, { limit = 20, cursor = null }) {
  const params = [memberId];
  let keyset = '';
  if (cursor) {
    params.push(cursor.finished_at, cursor.id);
    keyset = ` and (g.finished_at, g.id) < ($${params.length - 1}::timestamptz, $${params.length})`;
  }
  params.push(limit + 1);
  const result = await query(
    `select g.*, w.username as white_username, b.username as black_username,
            to_char(g.finished_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as finished_at_key
       from games g
       left join members w on w.id = g.white_id
       left join members b on b.id = g.black_id
      where g.status = 'finished' and (g.white_id = $1 or g.black_id = $1)
        and (g.white_id is null or g.black_id is null or g.white_id <> g.black_id)
        ${keyset}
      order by g.finished_at desc, g.id desc
      limit $${params.length}`,
    params,
  );
  const page = result.rows.slice(0, limit);
  const next = result.rows.length > limit && page.length
    ? encodeCursor({ finished_at: page[page.length - 1].finished_at_key, id: page[page.length - 1].id })
    : null;
  return {
    games: page.map((row) => ({
      game_id: row.id,
      id: row.id,
      opponent: row.white_id === memberId ? (row.black_username || 'The house') : (row.white_username || 'The house'),
      colour: row.white_id === memberId ? 'White' : 'Black',
      result: row.result,
      reason: row.end_reason,
      rated: row.rated,
      finished_at: row.finished_at,
      record_url: `/game/${row.id}/record`,
    })),
    next_cursor: next,
  };
}

router.get('/members/:username/games', route(async (req, res) => {
  requireMember(req);
  const member = await memberByUsername(req.params.username);
  if (!member) fail(404, 'There is no member by that name.');
  const limit = pageLimit(req.query.limit, 20, 100);
  const cursor = decodeCursor(req.query.cursor);
  const page = await finishedGames(member.id, { limit, cursor });
  res.json(page);
}));

router.put('/members/:username/avatar', route(async (req, res) => {
  const member = requireMember(req);
  const target = await memberByUsername(req.params.username);
  if (!target) fail(404, 'There is no member by that name.');
  if (target.id !== member.id) fail(403, 'A member may only change their own picture.');
  await applyAvatar(req, res, member);
}));

router.patch('/members/:username/profile', route(async (req, res) => {
  const member = requireMember(req);
  const target = await memberByUsername(req.params.username);
  if (!target) fail(404, 'There is no member by that name.');
  if (target.id !== member.id) fail(403, 'A member may only change their own preferences.');
  const updated = await applyProfilePatch(member, bodyObject(req));
  res.json({ ...publicMember(updated), view: updated.view, piece_set_2d: updated.piece_set_2d, piece_set_3d: updated.piece_set_3d, theme: updated.theme, sound: updated.sound });
}));

export async function ladder({ limit = 50, cursor = null }) {
  const params = [];
  let keyset = '';
  if (cursor) {
    params.push(cursor.rating, cursor.rated_games, cursor.username);
    // Rating and games descending, username ascending.
    keyset = `where (m.rating < $1::int)
                 or (m.rating = $1::int and m.rated_games < $2::int)
                 or (m.rating = $1::int and m.rated_games = $2::int and lower(m.username) > $3)`;
  }
  params.push(limit + 1);
  const result = await query(
    `select m.* from members m ${keyset}
      order by m.rating desc, m.rated_games desc, lower(m.username) asc
      limit $${params.length}`,
    params,
  );
  const page = result.rows.slice(0, limit);
  const next = result.rows.length > limit && page.length
    ? encodeCursor({
      rating: page[page.length - 1].rating,
      rated_games: page[page.length - 1].rated_games,
      username: page[page.length - 1].username.toLowerCase(),
    })
    : null;
  return { members: page.map(publicMember), next_cursor: next };
}

router.get('/leaderboard', route(async (req, res) => {
  requireMember(req);
  const limit = pageLimit(req.query.limit, 50, 100);
  const cursor = decodeCursor(req.query.cursor);
  res.json(await ladder({ limit, cursor }));
}));

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const NOTIFICATION_TEXT = {
  challenge: (actor) => `${actor || 'A member'} challenged you to a game.`,
  move: (actor) => `${actor || 'Your opponent'} played a move.`,
  chat: (actor) => `${actor || 'Your opponent'} sent a message.`,
};

export async function notificationsFor(memberId) {
  const list = await rows(
    `select n.*, a.username as actor_username from notifications n
       left join members a on a.id = n.actor_id
      where n.member_id = $1 order by n.created_at desc, n.id desc limit 100`,
    [memberId],
  );
  const unread = await one(
    'select count(*)::int as unread from notifications where member_id = $1 and read = false',
    [memberId],
  );
  return {
    notifications: list.map((row) => ({
      id: row.id,
      notification_id: row.id,
      kind: row.kind,
      game_id: row.game_id,
      actor: row.actor_username || null,
      text: (NOTIFICATION_TEXT[row.kind] || (() => 'Something happened.'))(row.actor_username),
      read: row.read,
      created_at: row.created_at,
    })),
    unread: unread.unread,
  };
}

router.get('/notifications', route(async (req, res) => {
  const member = requireMember(req);
  res.json(await notificationsFor(member.id));
}));

router.post('/notifications/:notification_id/read', route(async (req, res) => {
  const member = requireMember(req);
  const notification = await one('select * from notifications where id = $1', [req.params.notification_id]);
  if (!notification) fail(404, 'That notification is not here.');
  if (notification.member_id !== member.id) fail(403, 'That notification belongs to another member.');
  await query('update notifications set read = true where id = $1 and read = false', [notification.id]);
  const unread = await one(
    'select count(*)::int as unread from notifications where member_id = $1 and read = false',
    [member.id],
  );
  res.json({ unread: unread.unread });
}));

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

router.post('/blocks', route(async (req, res) => {
  const member = requireMember(req);
  const username = requireString(bodyObject(req).username, 'username', { max: 40 });
  if (!isValidUsername(username)) fail(422, 'That is not a username.');
  const target = await memberByUsername(username);
  if (!target) fail(404, 'There is no member by that name.');
  if (target.id === member.id) fail(422, 'You cannot block yourself.');
  await query(
    'insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing',
    [member.id, target.id],
  );
  res.status(201).json({ blocker: member.username, blocked: target.username });
}));

router.delete('/blocks/:username', route(async (req, res) => {
  const member = requireMember(req);
  const target = await memberByUsername(req.params.username);
  if (!target) fail(404, 'There is no member by that name.');
  await query('delete from blocks where blocker_id = $1 and blocked_id = $2', [member.id, target.id]);
  res.json({ ok: true });
}));

export async function blocksFor(memberId) {
  return rows(
    `select m.username, m.avatar_key, m.id from blocks b join members m on m.id = b.blocked_id
      where b.blocker_id = $1 order by lower(m.username)`,
    [memberId],
  );
}
