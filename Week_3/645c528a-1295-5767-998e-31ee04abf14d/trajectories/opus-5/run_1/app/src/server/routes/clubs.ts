import { randomUUID } from 'node:crypto';
import { CLUB_CAPACITY, CLUB_FEE, CLUB_MIN_LEVEL } from '../../shared/catalog.js';
import { CLUB_COPY } from '../../shared/copy.js';
import { query, queryOne, transaction } from '../db.js';
import { ApiError } from '../errors.js';
import { publish } from '../events.js';
import { objectBody, type Ctx, type Router } from '../http.js';
import { spend } from '../ledger.js';
import { weekStart } from '../players.js';
import { requireSession } from '../session.js';
import { publishPlayer } from '../tables.js';
import { friendIdsOf } from './social.js';

const WEEKLY = `CASE WHEN p.seeded THEN p.weekly_wins WHEN p.week_start = $1::date THEN p.weekly_wins ELSE 0 END`;

interface ClubRow {
  id: string;
  name: string;
  join_policy: string;
}

async function clubBody(id: string): Promise<Record<string, unknown> | null> {
  const club = await queryOne<ClubRow>(`SELECT id, name, join_policy FROM clubs WHERE id = $1`, [id]);
  if (!club) return null;
  const members = await query<{ player_id: string; display_name: string; role: string; weekly: string }>(
    `SELECT m.player_id, p.display_name, m.role, ${WEEKLY} AS weekly
       FROM club_members m JOIN players p ON p.id = m.player_id
      WHERE m.club_id = $2 ORDER BY m.joined_at`,
    [weekStart(), id],
  );
  const requests = await query<{ player_id: string; display_name: string }>(
    `SELECT r.player_id, p.display_name FROM club_requests r JOIN players p ON p.id = r.player_id
      WHERE r.club_id = $1 ORDER BY r.created_at`,
    [id],
  );
  const messages = await query<{ id: string; player_id: string; display_name: string; preset: string; created_at: Date }>(
    `SELECT c.id, c.player_id, p.display_name, c.preset, c.created_at FROM club_messages c JOIN players p ON p.id = c.player_id
      WHERE c.club_id = $1 ORDER BY c.created_at ASC LIMIT 50`,
    [id],
  );
  return {
    id: club.id,
    name: club.name,
    joinPolicy: club.join_policy,
    memberCount: members.length,
    weeklyScore: members.reduce((total, member) => total + Number(member.weekly), 0),
    members: members.map((member) => ({
      playerId: member.player_id,
      displayName: member.display_name,
      role: member.role,
      weeklyWins: Number(member.weekly),
    })),
    requests: requests.map((request) => ({ playerId: request.player_id, displayName: request.display_name })),
    messages: messages.map((message) => ({
      id: message.id,
      playerId: message.player_id,
      displayName: message.display_name,
      preset: message.preset,
      createdAt: new Date(message.created_at).toISOString(),
    })),
  };
}

async function roleIn(clubId: string, playerId: string): Promise<string | null> {
  const row = await queryOne<{ role: string }>(`SELECT role FROM club_members WHERE club_id = $1 AND player_id = $2`, [clubId, playerId]);
  return row?.role ?? null;
}

export function registerClubRoutes(router: Router): void {
  router.get('/api/clubs', async () => {
    const rows = await query<{ id: string; name: string; join_policy: string; member_count: string; weekly_score: string }>(
      `SELECT c.id, c.name, c.join_policy,
              count(m.player_id)::text AS member_count,
              COALESCE(sum(${WEEKLY}), 0)::text AS weekly_score
         FROM clubs c
         LEFT JOIN club_members m ON m.club_id = c.id
         LEFT JOIN players p ON p.id = m.player_id
        GROUP BY c.id, c.name, c.join_policy
        ORDER BY c.name`,
      [weekStart()],
    );
    return {
      status: 200,
      body: {
        clubs: rows.map((row) => ({
          id: row.id,
          name: row.name,
          joinPolicy: row.join_policy,
          memberCount: Number(row.member_count),
          weeklyScore: Number(row.weekly_score),
        })),
      },
    };
  });

  router.post('/api/clubs', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const body = objectBody(ctx);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const joinPolicy = body.joinPolicy === 'request' ? 'request' : 'open';
    if (player.level < CLUB_MIN_LEVEL) throw new ApiError(403, 'level_locked', CLUB_COPY.createLevel);
    const existingMembership = await queryOne(`SELECT 1 FROM club_members WHERE player_id = $1`, [player.id]);
    if (existingMembership) throw new ApiError(409, 'already_in_club', 'You are already in a club.');
    if (Number(player.coins) < CLUB_FEE) throw new ApiError(409, 'insufficient_coins', CLUB_COPY.createCoins);
    const taken = await queryOne(`SELECT 1 FROM clubs WHERE lower(name) = lower($1)`, [name]);
    if (taken) throw new ApiError(409, 'name_taken', 'That club name is taken.');
    if (name.length < 3 || name.length > 24) throw ApiError.validation({ name: 'Use 3 to 24 characters.' });
    if (body.joinPolicy !== undefined && body.joinPolicy !== 'open' && body.joinPolicy !== 'request') {
      throw ApiError.validation({ joinPolicy: 'Use open or request.' });
    }
    const id = randomUUID();
    await transaction(async (client) => {
      await client.query(`INSERT INTO clubs (id, name, join_policy) VALUES ($1,$2,$3)`, [id, name, joinPolicy]);
      await client.query(`INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,'owner')`, [id, player.id]);
      await spend(client, player.id, 'coins', CLUB_FEE, 'club_fee', id);
    });
    publishPlayer(player.id);
    return { status: 201, body: await clubBody(id) };
  });

  router.get('/api/clubs/:id', async (ctx: Ctx) => {
    const body = await clubBody(ctx.params.id as string);
    if (!body) throw ApiError.notFound('No such club.');
    return { status: 200, body };
  });

  router.post('/api/clubs/:id/join', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const clubId = ctx.params.id as string;
    const club = await queryOne<ClubRow>(`SELECT id, name, join_policy FROM clubs WHERE id = $1`, [clubId]);
    if (!club) throw ApiError.notFound('No such club.');
    const outcome = await transaction(async (client) => {
      const mine = await client.query(`SELECT 1 FROM club_members WHERE player_id = $1`, [player.id]);
      if (mine.rows.length > 0) return 'already_in_club' as const;
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM club_members WHERE club_id = $1`,
        [clubId],
      );
      if (Number(count.rows[0]?.count ?? '0') >= CLUB_CAPACITY) return 'club_full' as const;
      if (club.join_policy === 'request') {
        await client.query(`INSERT INTO club_requests (club_id, player_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [clubId, player.id]);
        return 'requested' as const;
      }
      await client.query(`INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,'member')`, [clubId, player.id]);
      return 'member' as const;
    });
    if (outcome === 'already_in_club') throw new ApiError(409, 'already_in_club', 'You are already in a club.');
    if (outcome === 'club_full') throw new ApiError(409, 'club_full', CLUB_COPY.full);
    publish(`club:${clubId}`, 'club', { changed: true });
    if (outcome === 'requested') return { status: 202, body: { status: 'requested' } };
    return { status: 200, body: { status: 'member' } };
  });

  router.post('/api/clubs/:id/leave', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const clubId = ctx.params.id as string;
    const role = await roleIn(clubId, player.id);
    if (!role) throw new ApiError(409, 'not_a_member', 'You are not in this club.');
    const others = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM club_members WHERE club_id = $1 AND player_id <> $2`,
      [clubId, player.id],
    );
    const remaining = Number(others?.count ?? '0');
    if (role === 'owner' && remaining > 0) throw new ApiError(409, 'owner_must_transfer', CLUB_COPY.ownerLeaving);
    await query(`DELETE FROM club_members WHERE club_id = $1 AND player_id = $2`, [clubId, player.id]);
    if (role === 'owner' && remaining === 0) await query(`DELETE FROM clubs WHERE id = $1`, [clubId]);
    publish(`club:${clubId}`, 'club', { changed: true });
    return { status: 204, body: null };
  });

  router.post('/api/clubs/:id/requests/:playerId', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const clubId = ctx.params.id as string;
    const targetId = ctx.params.playerId as string;
    const role = await roleIn(clubId, player.id);
    if (role !== 'owner' && role !== 'officer') throw new ApiError(403, 'not_allowed', 'Only owners and officers decide requests.');
    const body = objectBody(ctx);
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      throw ApiError.validation({ decision: 'Use approve or reject.' });
    }
    if (body.decision === 'reject') {
      await query(`DELETE FROM club_requests WHERE club_id = $1 AND player_id = $2`, [clubId, targetId]);
      publish(`club:${clubId}`, 'club', { changed: true });
      return { status: 200, body: { status: 'rejected' } };
    }
    const outcome = await transaction(async (client) => {
      const count = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM club_members WHERE club_id = $1`, [clubId]);
      if (Number(count.rows[0]?.count ?? '0') >= CLUB_CAPACITY) return 'club_full' as const;
      await client.query(`DELETE FROM club_requests WHERE club_id = $1 AND player_id = $2`, [clubId, targetId]);
      await client.query(`INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,'member') ON CONFLICT (player_id) DO NOTHING`, [
        clubId,
        targetId,
      ]);
      return 'member' as const;
    });
    if (outcome === 'club_full') throw new ApiError(409, 'club_full', CLUB_COPY.full);
    publish(`club:${clubId}`, 'club', { changed: true });
    return { status: 200, body: { status: 'member' } };
  });

  router.patch('/api/clubs/:id/members/:playerId', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const clubId = ctx.params.id as string;
    const targetId = ctx.params.playerId as string;
    const role = await roleIn(clubId, player.id);
    if (role !== 'owner') throw new ApiError(403, 'not_allowed', 'Only the owner changes roles.');
    const body = objectBody(ctx);
    const next = body.role;
    if (next !== 'owner' && next !== 'officer' && next !== 'member') {
      throw ApiError.validation({ role: 'Use owner, officer or member.' });
    }
    const target = await roleIn(clubId, targetId);
    if (!target) throw ApiError.notFound('That player is not in this club.');
    await transaction(async (client) => {
      await client.query(`UPDATE club_members SET role = $1 WHERE club_id = $2 AND player_id = $3`, [next, clubId, targetId]);
      if (next === 'owner' && targetId !== player.id) {
        await client.query(`UPDATE club_members SET role = 'officer' WHERE club_id = $1 AND player_id = $2`, [clubId, player.id]);
      }
    });
    publish(`club:${clubId}`, 'club', { changed: true });
    return { status: 200, body: await clubBody(clubId) };
  });

  router.post('/api/clubs/:id/messages', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const clubId = ctx.params.id as string;
    const role = await roleIn(clubId, player.id);
    if (!role) throw new ApiError(403, 'not_a_member', 'Join the club to send messages.');
    const body = objectBody(ctx);
    const preset = typeof body.preset === 'string' ? body.preset : '';
    if (!CLUB_COPY.presets.includes(preset)) throw ApiError.validation({ preset: 'Pick a preset message.' });
    const id = randomUUID();
    await query(`INSERT INTO club_messages (id, club_id, player_id, preset) VALUES ($1,$2,$3,$4)`, [id, clubId, player.id, preset]);
    publish(`club:${clubId}`, 'club', { changed: true });
    return { status: 201, body: { messageId: id } };
  });

  router.get('/api/leaderboards', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const scope = ctx.url.searchParams.get('scope') ?? 'global';
    if (scope !== 'global' && scope !== 'friends' && scope !== 'club') {
      throw ApiError.validation({ scope: 'Use global, friends or club.' });
    }
    let ids: string[] | null = null;
    if (scope === 'friends') {
      ids = await friendIdsOf(player.id);
    } else if (scope === 'club') {
      const membership = await queryOne<{ club_id: string }>(`SELECT club_id FROM club_members WHERE player_id = $1`, [player.id]);
      if (!membership) ids = [];
      else {
        const members = await query<{ player_id: string }>(`SELECT player_id FROM club_members WHERE club_id = $1`, [membership.club_id]);
        ids = members.map((row) => row.player_id);
      }
    }
    const rows =
      ids === null
        ? await query<{ id: string; display_name: string; wins: string }>(
            `SELECT p.id, p.display_name, ${WEEKLY}::text AS wins FROM players p
              WHERE p.deleted = FALSE AND ${WEEKLY} > 0
              ORDER BY ${WEEKLY} DESC, p.last_win_at ASC NULLS LAST, p.display_name ASC LIMIT 100`,
            [weekStart()],
          )
        : ids.length === 0
          ? []
          : await query<{ id: string; display_name: string; wins: string }>(
              `SELECT p.id, p.display_name, ${WEEKLY}::text AS wins FROM players p
                WHERE p.deleted = FALSE AND p.id = ANY($2::uuid[]) AND ${WEEKLY} > 0
                ORDER BY ${WEEKLY} DESC, p.last_win_at ASC NULLS LAST, p.display_name ASC LIMIT 100`,
              [weekStart(), ids],
            );
    const ranked = rows.map((row, index) => ({
      rank: index + 1,
      playerId: row.id,
      displayName: row.display_name,
      wins: Number(row.wins),
    }));
    const ownRow = await queryOne<{ wins: string }>(`SELECT ${WEEKLY}::text AS wins FROM players p WHERE p.id = $2`, [
      weekStart(),
      player.id,
    ]);
    const ownWins = Number(ownRow?.wins ?? '0');
    const inScope = ranked.find((row) => row.playerId === player.id);
    return {
      status: 200,
      body: {
        rows: ranked,
        own: { rank: ownWins === 0 ? null : inScope?.rank ?? null, wins: ownWins },
      },
    };
  });
}
