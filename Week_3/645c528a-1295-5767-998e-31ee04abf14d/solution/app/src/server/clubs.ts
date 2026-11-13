import { randomUUID } from 'node:crypto';
import { CLUB_CAPACITY, CLUB_FEE, CLUB_MIN_LEVEL, PRESET_MESSAGES, formatNumber } from '../shared/domain';
import { playerById } from './auth';
import { query, transaction, type Db } from './db';
import { ApiError, assertUuid, isUniqueViolation, notFound, validationFailed } from './errors';
import { route, type Json } from './http';
import { SYSTEM, balance, lockPlayer, wallet, writePair } from './ledger';
import { notifyPlayer, publish } from './realtime';

type Role = 'owner' | 'officer' | 'member';

const ROLES: readonly Role[] = ['owner', 'officer', 'member'];
const CLUB_FULL = 'Club is full';

const WEEKLY_WINS = `COALESCE(p.fixed_weekly_wins, (
  SELECT w.wins FROM weekly_wins w WHERE w.player_id = p.id AND w.week_start = date_trunc('week', now() AT TIME ZONE 'UTC')::date
), 0)`;

interface ClubRow {
  id: string;
  name: string;
  join_policy: string;
  member_count: string;
  weekly_score: string;
}

const CLUB_LIST = `
  SELECT c.id, c.name, c.join_policy, COUNT(m.player_id) AS member_count, COALESCE(SUM(${WEEKLY_WINS}), 0) AS weekly_score
  FROM clubs c LEFT JOIN club_members m ON m.club_id = c.id LEFT JOIN players p ON p.id = m.player_id`;

function listFields(club: ClubRow): Json {
  return { id: club.id, name: club.name, joinPolicy: club.join_policy, memberCount: Number(club.member_count), weeklyScore: Number(club.weekly_score) };
}

async function clubBody(client: Db, id: string): Promise<Json> {
  assertUuid(id);
  const clubs = await client.query<ClubRow>(`${CLUB_LIST} WHERE c.id = $1 GROUP BY c.id`, [id]);
  if (clubs.rows.length === 0) throw notFound();
  const members = await client.query<{ player_id: string; display_name: string; role: Role; weekly_wins: number }>(
    `SELECT m.player_id, p.display_name, m.role, ${WEEKLY_WINS} AS weekly_wins FROM club_members m JOIN players p ON p.id = m.player_id
     WHERE m.club_id = $1 ORDER BY m.ordinal`,
    [id],
  );
  const requests = await client.query<{ player_id: string; display_name: string }>(
    'SELECT r.player_id, p.display_name FROM club_requests r JOIN players p ON p.id = r.player_id WHERE r.club_id = $1',
    [id],
  );
  const messages = await client.query<{ id: string; display_name: string; preset: string }>(
    `SELECT * FROM (SELECT m.id, p.display_name, m.preset, m.seq FROM club_messages m JOIN players p ON p.id = m.player_id
     WHERE m.club_id = $1 ORDER BY m.seq DESC LIMIT 50) recent ORDER BY seq`,
    [id],
  );
  return {
    ...listFields(clubs.rows[0]),
    members: members.rows.map((member) => ({ playerId: member.player_id, displayName: member.display_name, role: member.role, weeklyWins: Number(member.weekly_wins) })),
    requests: requests.rows.map((request) => ({ playerId: request.player_id, displayName: request.display_name })),
    messages: messages.rows.map((message) => ({ id: message.id, displayName: message.display_name, preset: message.preset })),
  };
}

async function lockClub(client: Db, id: string): Promise<{ id: string; join_policy: string; name: string }> {
  assertUuid(id);
  const { rows } = await client.query<{ id: string; join_policy: string; name: string }>('SELECT id, join_policy, name FROM clubs WHERE id = $1 FOR UPDATE', [id]);
  if (rows.length === 0) throw notFound();
  return rows[0];
}

async function memberCount(client: Db, clubId: string): Promise<number> {
  const { rows } = await client.query<{ total: string }>('SELECT COUNT(*) AS total FROM club_members WHERE club_id = $1', [clubId]);
  return Number(rows[0].total);
}

async function roleIn(client: Db, clubId: string, playerId: string): Promise<Role | null> {
  const { rows } = await client.query<{ role: Role }>('SELECT role FROM club_members WHERE club_id = $1 AND player_id = $2', [clubId, playerId]);
  return rows[0]?.role ?? null;
}

async function inAnyClub(client: Db, playerId: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM club_members WHERE player_id = $1', [playerId]);
  return rows.length > 0;
}

function touch(id: string): void {
  publish(`club:${id}`, {});
}


export function registerClubRoutes(): void {
  route('GET', '/api/clubs', async () => {
    const rows = await query<ClubRow>(`${CLUB_LIST} GROUP BY c.id ORDER BY weekly_score DESC, c.name`);
    return { status: 200, body: { clubs: rows.map(listFields) } };
  });

  route('POST', '/api/clubs', async ({ session, body }) => {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const answer = await transaction(async (client) => {
      await lockPlayer(client, session.playerId);
      const player = await playerById(client, session.playerId);
      if (player.level < CLUB_MIN_LEVEL) throw new ApiError(403, 'level_locked', `Reach level ${CLUB_MIN_LEVEL} to create a club.`);
      if ((await balance(client, player.id, 'coins')) < CLUB_FEE) throw new ApiError(409, 'insufficient_coins', `You need ${formatNumber(CLUB_FEE)} Coins to create a club.`);
      if (await inAnyClub(client, player.id)) throw new ApiError(409, 'already_in_club', 'You are already in a club.');
      const taken = await client.query('SELECT 1 FROM clubs WHERE name = $1', [name]);
      if (taken.rows.length > 0) throw new ApiError(409, 'name_taken', 'That club name is taken.');
      const errors: Record<string, string> = {};
      if (name.length < 3 || name.length > 24) errors.name = 'Use 3 to 24 characters.';
      if (body.joinPolicy !== 'open' && body.joinPolicy !== 'request') errors.joinPolicy = 'Choose a join policy.';
      if (Object.keys(errors).length > 0) throw validationFailed(errors);
      const id = randomUUID();
      await client.query('INSERT INTO clubs (id, name, join_policy) VALUES ($1,$2,$3)', [id, name, body.joinPolicy]);
      await client.query(`INSERT INTO club_members (player_id, club_id, role) VALUES ($1,$2,'owner')`, [player.id, id]);
      await writePair(client, { from: wallet(player.id), to: SYSTEM, amount: CLUB_FEE, currency: 'coins', kind: 'club_fee', refId: id });
      return clubBody(client, id);
    }).catch((error: unknown) => {
      throw isUniqueViolation(error) ? new ApiError(409, 'name_taken', 'That club name is taken.') : error;
    });
    notifyPlayer(session.playerId);
    return { status: 201, body: answer };
  }, { body: true });

  route('GET', '/api/clubs/{id}', async ({ params }) => {
    return { status: 200, body: await transaction((client) => clubBody(client, params.id)) };
  });

  route('POST', '/api/clubs/{id}/join', async ({ session, params }) => {
    const reply = await transaction(async (client) => {
      const club = await lockClub(client, params.id);
      if (await inAnyClub(client, session.playerId)) throw new ApiError(409, 'already_in_club', 'You are already in a club.');
      if ((await memberCount(client, club.id)) >= CLUB_CAPACITY) throw new ApiError(409, 'club_full', CLUB_FULL);
      if (club.join_policy === 'request') {
        await client.query('INSERT INTO club_requests (club_id, player_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [club.id, session.playerId]);
        return { status: 202, body: { status: 'requested' } };
      }
      await client.query(`INSERT INTO club_members (player_id, club_id, role) VALUES ($1,$2,'member')`, [session.playerId, club.id]);
      return { status: 200, body: { status: 'member' } };
    }).catch((error: unknown) => {
      throw isUniqueViolation(error) ? new ApiError(409, 'already_in_club', 'You are already in a club.') : error;
    });
    touch(params.id);
    return reply;
  });

  route('POST', '/api/clubs/{id}/leave', async ({ session, params }) => {
    await transaction(async (client) => {
      const club = await lockClub(client, params.id);
      const role = await roleIn(client, club.id, session.playerId);
      if (role === null) throw new ApiError(409, 'not_a_member', 'You are not in this club.');
      const count = await memberCount(client, club.id);
      if (role === 'owner' && count > 1) throw new ApiError(409, 'owner_must_transfer', 'Owners must hand over the club before leaving.');
      await client.query('DELETE FROM club_members WHERE player_id = $1', [session.playerId]);
      if (count === 1) await client.query('DELETE FROM clubs WHERE id = $1', [club.id]);
    });
    touch(params.id);
    return { status: 204 };
  });

  route('POST', '/api/clubs/{id}/requests/{playerId}', async ({ session, params, body }) => {
    const reply = await transaction(async (client) => {
      const club = await lockClub(client, params.id);
      const role = await roleIn(client, club.id, session.playerId);
      if (role !== 'owner' && role !== 'officer') throw new ApiError(403, 'forbidden', 'Only the owner and officers decide requests.');
      const pending = await client.query('SELECT 1 FROM club_requests WHERE club_id = $1 AND player_id::text = $2', [club.id, params.playerId]);
      if (pending.rows.length === 0) throw notFound();
      if (body.decision === 'approve' && (await memberCount(client, club.id)) >= CLUB_CAPACITY) throw new ApiError(409, 'club_full', CLUB_FULL);
      if (body.decision !== 'approve' && body.decision !== 'reject') throw validationFailed({ decision: 'Use approve or reject.' });
      await client.query('DELETE FROM club_requests WHERE club_id = $1 AND player_id::text = $2', [club.id, params.playerId]);
      if (body.decision === 'reject') return { status: 'rejected' };
      if (await inAnyClub(client, params.playerId)) throw new ApiError(409, 'already_in_club', 'That player is already in a club.');
      await client.query(`INSERT INTO club_members (player_id, club_id, role) VALUES ($1,$2,'member')`, [params.playerId, club.id]);
      return { status: 'member' };
    });
    touch(params.id);
    return { status: 200, body: reply };
  }, { body: true });

  route('PATCH', '/api/clubs/{id}/members/{playerId}', async ({ session, params, body }) => {
    const answer = await transaction(async (client) => {
      const club = await lockClub(client, params.id);
      if ((await roleIn(client, club.id, session.playerId)) !== 'owner') throw new ApiError(403, 'forbidden', 'Only the owner changes roles.');
      if ((await roleIn(client, club.id, params.playerId)) === null) throw notFound();
      if (!ROLES.includes(body.role as Role)) throw validationFailed({ role: 'Use owner, officer or member.' });
      if (params.playerId === session.playerId) return clubBody(client, club.id);
      await client.query('UPDATE club_members SET role = $2 WHERE player_id::text = $1', [params.playerId, body.role]);
      if (body.role === 'owner') await client.query(`UPDATE club_members SET role = 'officer' WHERE player_id = $1`, [session.playerId]);
      return clubBody(client, club.id);
    });
    touch(params.id);
    return { status: 200, body: answer };
  }, { body: true });

  route('POST', '/api/clubs/{id}/messages', async ({ session, params, body }) => {
    const messageId = await transaction(async (client) => {
      const club = await lockClub(client, params.id);
      if ((await roleIn(client, club.id, session.playerId)) === null) throw new ApiError(403, 'forbidden', 'Join this club to send messages.');
      if (typeof body.preset !== 'string' || !PRESET_MESSAGES.includes(body.preset)) throw validationFailed({ preset: 'Choose a preset message.' });
      const id = randomUUID();
      await client.query('INSERT INTO club_messages (id, club_id, player_id, preset) VALUES ($1,$2,$3,$4)', [id, club.id, session.playerId, body.preset]);
      return id;
    });
    touch(params.id);
    return { status: 201, body: { messageId } };
  }, { body: true });

  route('GET', '/api/leaderboards', async ({ session, query: search }) => {
    const scope = search.get('scope');
    if (scope !== 'global' && scope !== 'friends' && scope !== 'club') throw validationFailed({ scope: 'Use global, friends or club.' });
    const id = session.playerId;
    const filter = {
      global: '',
      friends: `AND (p.id = $1 OR p.id IN (SELECT friend_id FROM friendships WHERE player_id = $1))`,
      club: `AND p.id IN (SELECT player_id FROM club_members WHERE club_id = (SELECT club_id FROM club_members WHERE player_id = $1))`,
    }[scope];
    const ranked = await query<{ id: string; display_name: string; wins: number; rank: string }>(
      `SELECT * FROM (
         SELECT p.id, p.display_name, ${WEEKLY_WINS} AS wins, RANK() OVER (
           ORDER BY ${WEEKLY_WINS} DESC,
             (SELECT w.last_win_at FROM weekly_wins w WHERE w.player_id = p.id AND w.week_start = date_trunc('week', now() AT TIME ZONE 'UTC')::date) ASC NULLS FIRST,
             p.display_name, p.id
         ) AS rank
         FROM players p WHERE p.deleted_at IS NULL AND ${WEEKLY_WINS} > 0 AND ($1::uuid IS NOT NULL) ${filter}
       ) board ORDER BY rank`,
      [id],
    );
    const own = ranked.find((row) => row.id === id);
    const ownWins = await query<{ wins: number }>(`SELECT ${WEEKLY_WINS} AS wins FROM players p WHERE p.id = $1`, [id]);
    return {
      status: 200,
      body: {
        rows: ranked.slice(0, 100).map((row) => ({ rank: Number(row.rank), playerId: row.id, displayName: row.display_name, wins: row.wins })),
        own: { rank: own === undefined ? null : Number(own.rank), wins: ownWins[0].wins },
      },
    };
  });
}
