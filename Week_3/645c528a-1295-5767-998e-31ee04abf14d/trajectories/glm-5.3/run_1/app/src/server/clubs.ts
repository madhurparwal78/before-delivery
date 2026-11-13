import type { Db } from './db.js';
import type { Ctx } from './http.js';
import { sendJson, sendEmpty } from './http.js';
import { ApiError, errors } from './errors.js';
import { copy, PRESET_MESSAGES } from './copy.js';
import { requirePlayerId } from './auth.js';
import { id as newId } from './util.js';
import { writePair, walletBalance } from './ledger.js';
import { loadPlayer } from './players.js';
import { CLUB_CAPACITY, CLUB_CREATE_COINS, CLUB_CREATE_LEVEL } from '../shared/game.js';
import type { ClubBody, ClubSummary } from '../shared/types.js';

export interface ClubDeps {
  db: Db;
  onClubChange: (clubId: string, playerIds: string[]) => void;
  onMeChange: (playerId: string) => void;
}

async function clubSummaries(db: Db): Promise<ClubSummary[]> {
  const res = await db.query<{ id: string; name: string; join_policy: 'open' | 'request'; weekly_score: number; member_count: string }>(
    `SELECT c.id, c.name, c.join_policy, c.weekly_score,
            (SELECT COUNT(*) FROM club_members m WHERE m.club_id = c.id) AS member_count
     FROM clubs c ORDER BY c.name`
  );
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    joinPolicy: row.join_policy,
    memberCount: Number(row.member_count),
    weeklyScore: row.weekly_score,
  }));
}

export async function listClubs(deps: ClubDeps, ctx: Ctx): Promise<void> {
  await requirePlayerId(deps.db, ctx);
  sendJson(ctx, 200, { clubs: await clubSummaries(deps.db) });
}

async function clubBody(db: Db, clubId: string, viewerId: string | null): Promise<ClubBody> {
  const club = (await db.query<{ id: string; name: string; join_policy: 'open' | 'request'; weekly_score: number; owner_id: string }>(
    `SELECT id, name, join_policy, weekly_score, owner_id FROM clubs WHERE id = $1`, [clubId]
  )).rows[0];
  if (!club) throw errors.notFound();
  const members = await db.query<{ player_id: string; display_name: string; role: 'owner' | 'officer' | 'member'; weekly_wins: number }>(
    `SELECT m.player_id, p.display_name, m.role, p.weekly_wins
     FROM club_members m JOIN players p ON p.id = m.player_id
     WHERE m.club_id = $1 ORDER BY m.joined_at`,
    [clubId]
  );
  const requests = await db.query<{ player_id: string; display_name: string }>(
    `SELECT r.player_id, p.display_name FROM club_requests r JOIN players p ON p.id = r.player_id WHERE r.club_id = $1 ORDER BY r.created_at`,
    [clubId]
  );
  const messages = await db.query<{ id: string; player_id: string; display_name: string; preset: string; created_at: Date }>(
    `SELECT m.id, m.player_id, m.display_name, m.preset, m.created_at FROM club_messages m WHERE m.club_id = $1 ORDER BY m.created_at DESC LIMIT 30`,
    [clubId]
  );
  const own = members.rows.find((m) => m.player_id === viewerId);
  return {
    id: club.id,
    name: club.name,
    joinPolicy: club.join_policy,
    memberCount: members.rows.length,
    weeklyScore: club.weekly_score,
    members: members.rows.map((m) => ({ playerId: m.player_id, displayName: m.display_name, role: m.role, weeklyWins: m.weekly_wins })),
    requests: requests.rows.map((r) => ({ playerId: r.player_id, displayName: r.display_name })),
    messages: messages.rows.reverse().map((m) => ({ messageId: m.id, playerId: m.player_id, displayName: m.display_name, preset: m.preset, createdAt: m.created_at.toISOString() })),
    ownRole: own?.role ?? null,
    ownerId: club.owner_id,
  };
}

export async function getClub(deps: ClubDeps, ctx: Ctx, clubId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  sendJson(ctx, 200, await clubBody(deps.db, clubId, playerId));
}

export async function createClub(deps: ClubDeps, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const body = ctx.body as { name?: string; joinPolicy?: string };
  const name = (body.name ?? '').trim();
  const policy = body.joinPolicy === 'request' ? 'request' : 'open';
  const fields: Record<string, string> = {};
  if (name.length < 3 || name.length > 24) fields.name = 'Use 3 to 24 characters.';
  if (body.joinPolicy !== undefined && body.joinPolicy !== 'open' && body.joinPolicy !== 'request') fields.joinPolicy = 'Choose Open or Request to join.';
  if (Object.keys(fields).length > 0) throw errors.validation(fields);

  const clubId = newId('club');
  await deps.db.tx(async (client) => {
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    const player = await loadPlayer(client, playerId);
    if (!player) throw errors.unauthenticated();
    if (player.level < CLUB_CREATE_LEVEL) throw new ApiError(403, 'level_locked', copy.clubLevel(CLUB_CREATE_LEVEL));
    const coins = await walletBalance(client, playerId, 'coins');
    if (coins < CLUB_CREATE_COINS) throw new ApiError(409, 'insufficient_coins', copy.clubCoins(CLUB_CREATE_COINS));
    const inClub = (await client.query(`SELECT 1 FROM club_members WHERE player_id = $1`, [playerId])).rowCount ?? 0;
    if (inClub > 0) throw new ApiError(409, 'already_in_club', 'You are already in a club.');
    const taken = (await client.query(`SELECT 1 FROM clubs WHERE lower(name) = lower($1)`, [name])).rowCount ?? 0;
    if (taken > 0) throw new ApiError(409, 'name_taken', 'That club name is taken.');
    await writePair(client, {
      kind: 'club_fee',
      refId: clubId,
      currency: 'coins',
      lines: [
        { playerId, currency: 'coins', account: 'wallet', amount: -CLUB_CREATE_COINS },
        { playerId: null, currency: 'coins', account: 'system', amount: CLUB_CREATE_COINS },
      ],
    });
    await client.query(`INSERT INTO clubs (id, name, join_policy, owner_id) VALUES ($1,$2,$3,$4)`, [clubId, name, policy, playerId]);
    await client.query(`INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,'owner')`, [clubId, playerId]);
  });
  deps.onMeChange(playerId);
  deps.onClubChange(clubId, [playerId]);
  sendJson(ctx, 201, await clubBody(deps.db, clubId, playerId));
}

export async function joinClub(deps: ClubDeps, ctx: Ctx, clubId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const result = await deps.db.tx(async (client) => {
    const club = (await client.query<{ id: string; name: string; join_policy: string; owner_id: string }>(`SELECT id, name, join_policy, owner_id FROM clubs WHERE id = $1 FOR UPDATE`, [clubId])).rows[0];
    if (!club) throw errors.notFound();
    const member = (await client.query(`SELECT 1 FROM club_members WHERE player_id = $1`, [playerId])).rowCount ?? 0;
    if (member > 0) throw new ApiError(409, 'already_in_club', 'You are already in a club.');
    const count = (await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM club_members WHERE club_id = $1`, [clubId])).rows[0];
    if (Number(count?.n ?? 0) >= CLUB_CAPACITY) throw new ApiError(409, 'club_full', copy.clubFull);
    if (club.join_policy === 'open') {
      await client.query(`INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,'member')`, [clubId, playerId]);
      await client.query(`DELETE FROM club_requests WHERE club_id = $1 AND player_id = $2`, [clubId, playerId]);
      await rescore(client, clubId);
      return { status: 'member' as const };
    }
    await client.query(`INSERT INTO club_requests (club_id, player_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [clubId, playerId]);
    return { status: 'requested' as const };
  });
  deps.onClubChange(clubId, [playerId]);
  sendJson(ctx, result.status === 'member' ? 200 : 202, result);
}

async function rescore(client: { query: Db['query'] }, clubId: string): Promise<void> {
  await client.query(
    `UPDATE clubs c SET weekly_score = COALESCE((SELECT SUM(p.weekly_wins) FROM club_members m JOIN players p ON p.id = m.player_id WHERE m.club_id = c.id), 0) WHERE c.id = $1`,
    [clubId]
  );
}

export async function leaveClub(deps: ClubDeps, ctx: Ctx, clubId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  await deps.db.tx(async (client) => {
    const club = (await client.query<{ id: string; owner_id: string }>(`SELECT id, owner_id FROM clubs WHERE id = $1 FOR UPDATE`, [clubId])).rows[0];
    if (!club) throw errors.notFound();
    const member = (await client.query<{ role: string }>(`SELECT role FROM club_members WHERE club_id = $1 AND player_id = $2`, [clubId, playerId])).rows[0];
    if (!member) throw new ApiError(409, 'not_a_member', 'You are not in this club.');
    if (member.role === 'owner') {
      const others = (await client.query<{ player_id: string }>(
        `SELECT player_id FROM club_members WHERE club_id = $1 AND player_id <> $2 ORDER BY joined_at LIMIT 1`, [clubId, playerId]
      )).rows[0];
      if (!others) {
        await client.query(`DELETE FROM clubs WHERE id = $1`, [clubId]);
        return;
      }
      await client.query(`UPDATE club_members SET role = 'owner' WHERE club_id = $1 AND player_id = $2`, [clubId, others.player_id]);
      await client.query(`UPDATE clubs SET owner_id = $2 WHERE id = $1`, [clubId, others.player_id]);
      await client.query(`UPDATE club_members SET role = 'officer' WHERE club_id = $1 AND player_id = $2`, [clubId, playerId]);
      await client.query(`DELETE FROM club_members WHERE club_id = $1 AND player_id = $2`, [clubId, playerId]);
      await rescore(client, clubId);
      return;
    }
    await client.query(`DELETE FROM club_members WHERE club_id = $1 AND player_id = $2`, [clubId, playerId]);
    await rescore(client, clubId);
  });
  deps.onClubChange(clubId, [playerId]);
  sendEmpty(ctx, 204);
}

export async function decideRequest(deps: ClubDeps, ctx: Ctx, clubId: string, playerId: string): Promise<void> {
  const approverId = await requirePlayerId(deps.db, ctx);
  const body = ctx.body as { decision?: string };
  const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : null;
  if (!decision) throw errors.validation({ decision: 'Choose approve or reject.' });
  const result = await deps.db.tx(async (client) => {
    const club = (await client.query<{ id: string; owner_id: string }>(`SELECT id, owner_id FROM clubs WHERE id = $1 FOR UPDATE`, [clubId])).rows[0];
    if (!club) throw errors.notFound();
    const officer = (await client.query<{ role: string }>(`SELECT role FROM club_members WHERE club_id = $1 AND player_id = $2`, [clubId, approverId])).rows[0];
    if (!officer || (officer.role !== 'owner' && officer.role !== 'officer')) {
      throw errors.forbidden('Only the owner and officers decide requests.');
    }
    const request = (await client.query(`SELECT 1 FROM club_requests WHERE club_id = $1 AND player_id = $2`, [clubId, playerId])).rowCount ?? 0;
    if (request === 0) throw errors.forbidden('No such request.');
    if (decision === 'reject') {
      await client.query(`DELETE FROM club_requests WHERE club_id = $1 AND player_id = $2`, [clubId, playerId]);
      return { status: 'rejected' as const };
    }
    const count = (await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM club_members WHERE club_id = $1`, [clubId])).rows[0];
    if (Number(count?.n ?? 0) >= CLUB_CAPACITY) throw new ApiError(409, 'club_full', copy.clubFull);
    const inClub = (await client.query(`SELECT 1 FROM club_members WHERE player_id = $1`, [playerId])).rowCount ?? 0;
    if (inClub > 0) {
      await client.query(`DELETE FROM club_requests WHERE club_id = $1 AND player_id = $2`, [clubId, playerId]);
      throw errors.forbidden('That player is already in a club.');
    }
    await client.query(`INSERT INTO club_members (club_id, player_id, role) VALUES ($1,$2,'member')`, [clubId, playerId]);
    await client.query(`DELETE FROM club_requests WHERE club_id = $1 AND player_id = $2`, [clubId, playerId]);
    await rescore(client, clubId);
    return { status: 'member' as const };
  });
  deps.onClubChange(clubId, [playerId, approverId]);
  sendJson(ctx, 200, result);
}

export async function changeRole(deps: ClubDeps, ctx: Ctx, clubId: string, targetId: string): Promise<void> {
  const ownerId = await requirePlayerId(deps.db, ctx);
  const body = ctx.body as { role?: string };
  const role = body.role;
  if (role !== 'owner' && role !== 'officer' && role !== 'member') {
    throw errors.validation({ role: 'Choose owner, officer or member.' });
  }
  await deps.db.tx(async (client) => {
    const club = (await client.query<{ id: string; owner_id: string }>(`SELECT id, owner_id FROM clubs WHERE id = $1 FOR UPDATE`, [clubId])).rows[0];
    if (!club) throw errors.notFound();
    if (club.owner_id !== ownerId) throw errors.forbidden('Only the owner changes roles.');
    const member = (await client.query<{ player_id: string }>(`SELECT player_id FROM club_members WHERE club_id = $1 AND player_id = $2`, [clubId, targetId])).rows[0];
    if (!member) throw errors.forbidden('That player is not in this club.');
    if (role === 'owner') {
      await client.query(`UPDATE club_members SET role = 'owner' WHERE club_id = $1 AND player_id = $2`, [clubId, targetId]);
      await client.query(`UPDATE club_members SET role = 'officer' WHERE club_id = $1 AND player_id = $2`, [clubId, ownerId]);
      await client.query(`UPDATE clubs SET owner_id = $2 WHERE id = $1`, [clubId, targetId]);
    } else {
      if (targetId === club.owner_id) throw errors.forbidden('Hand over the club first.');
      await client.query(`UPDATE club_members SET role = $3 WHERE club_id = $1 AND player_id = $2`, [clubId, targetId, role]);
    }
  });
  deps.onClubChange(clubId, [targetId, ownerId]);
  sendJson(ctx, 200, await clubBody(deps.db, clubId, ownerId));
}

export async function sendClubMessage(deps: ClubDeps, ctx: Ctx, clubId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const body = ctx.body as { preset?: string };
  const preset = body.preset ?? '';
  if (!(PRESET_MESSAGES as readonly string[]).includes(preset)) {
    throw errors.validation({ preset: 'Choose one of the preset messages.' });
  }
  const messageId = newId('cmsg');
  await deps.db.tx(async (client) => {
    const member = (await client.query<{ display_name: string }>(
      `SELECT p.display_name FROM club_members m JOIN players p ON p.id = m.player_id WHERE m.club_id = $1 AND m.player_id = $2`,
      [clubId, playerId]
    )).rows[0];
    if (!member) throw errors.forbidden('Only members may post.');
    await client.query(`INSERT INTO club_messages (id, club_id, player_id, display_name, preset) VALUES ($1,$2,$3,$4,$5)`,
      [messageId, clubId, playerId, member.display_name, preset]);
  });
  const members = await deps.db.query<{ player_id: string }>(`SELECT player_id FROM club_members WHERE club_id = $1`, [clubId]);
  deps.onClubChange(clubId, members.rows.map((m) => m.player_id));
  sendJson(ctx, 201, { messageId });
}

export async function leaderboard(deps: ClubDeps, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const scope = ctx.search.get('scope') ?? 'global';
  if (scope !== 'global' && scope !== 'friends' && scope !== 'club') {
    throw errors.validation({ scope: 'Choose global, friends or club.' });
  }

  const filter = await (async () => {
    if (scope === 'friends') {
      const res = await deps.db.query<{ id: string }>(
        `SELECT friend_id AS id FROM friends WHERE player_id = $1
         UNION SELECT $1`,
        [playerId]
      );
      return res.rows.map((r) => r.id);
    }
    if (scope === 'club') {
      const res = await deps.db.query<{ id: string }>(
        `SELECT m.player_id AS id FROM club_members m
         JOIN club_members me ON me.club_id = m.club_id AND me.player_id = $1`,
        [playerId]
      );
      return res.rows.map((r) => r.id);
    }
    return null;
  })();

  const rows = await deps.db.query<{ id: string; display_name: string; weekly_wins: number; last_win_at: Date | null }>(
    `SELECT id, display_name, weekly_wins, last_win_at FROM players
     WHERE deleted_at IS NULL AND weekly_wins > 0 AND ($1::text[] IS NULL OR id = ANY($1))
     ORDER BY weekly_wins DESC, last_win_at ASC NULLS LAST, display_name ASC LIMIT 50`,
    [filter]
  );

  const mine = (await deps.db.query<{ weekly_wins: number; last_win_at: Date | null }>(`SELECT weekly_wins, last_win_at FROM players WHERE id = $1`, [playerId])).rows[0];
  let own: { rank: number | null; wins: number } = { rank: null, wins: mine?.weekly_wins ?? 0 };
  if (mine && mine.weekly_wins > 0) {
    const ranked = rows.rows.findIndex((r) => r.id === playerId);
    own = { rank: ranked >= 0 ? ranked + 1 : null, wins: mine.weekly_wins };
  }

  sendJson(ctx, 200, {
    rows: rows.rows.map((r, i) => ({ rank: i + 1, playerId: r.id, displayName: r.display_name, wins: r.weekly_wins })),
    own,
  });
}
