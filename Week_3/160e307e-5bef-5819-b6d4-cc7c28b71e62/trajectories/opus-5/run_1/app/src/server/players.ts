import { randomUUID, randomInt, randomBytes } from 'node:crypto';
import { query, one, transaction } from './db.js';
import { ApiError, notFound, unprocessable } from './errors.js';
import type { Ctx } from './http.js';
import { DEFAULT_EQUIPPED, FREE_ITEM_IDS } from '../shared/catalogue.js';
import { nameShapeProblem, suggestionCandidates, guestName } from '../shared/names.js';
import { START_RATING, START_RD, START_VOLATILITY, round2, tierOf } from '../shared/rating.js';

export interface PlayerRow {
  id: string;
  name: string;
  avatar: number;
  chosen: boolean;
  email: string | null;
  rating: number;
  rd: number;
  volatility: number;
  ranked_games: number;
}

const SELECT_PLAYER =
  'select id, name, avatar, chosen, email, rating, rd, volatility, ranked_games from players';

export async function playerById(id: string): Promise<PlayerRow | null> {
  return one<PlayerRow>(`${SELECT_PLAYER} where id = $1`, [id]);
}

export async function playerByName(name: string): Promise<PlayerRow | null> {
  return one<PlayerRow>(`${SELECT_PLAYER} where name_lower = $1`, [name.toLowerCase()]);
}

async function freeGuestName(): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = guestName(String(randomInt(0, 10000)).padStart(4, '0'));
    const taken = await one<{ id: string }>('select id from players where name_lower = $1', [
      candidate.toLowerCase(),
    ]);
    if (taken === null) return candidate;
  }
  return guestName(String(randomInt(0, 10000)).padStart(4, '0'));
}

async function createPlayer(name: string, avatar: number, chosen: boolean): Promise<PlayerRow> {
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `insert into players (id, name, name_lower, avatar, chosen, rating, rd, volatility)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, name.toLowerCase(), avatar, chosen, START_RATING, START_RD, START_VOLATILITY],
    );
    await client.query(
      'insert into equipped_items (player_id, striker, board, coins) values ($1, $2, $3, $4)',
      [id, DEFAULT_EQUIPPED.striker, DEFAULT_EQUIPPED.board, DEFAULT_EQUIPPED.coins],
    );
    for (const itemId of FREE_ITEM_IDS) {
      await client.query('insert into owned_items (player_id, item_id) values ($1, $2)', [id, itemId]);
    }
  });
  const row = await playerById(id);
  if (row === null) throw new ApiError(503, 'DATABASE_UNAVAILABLE');
  return row;
}

/** Creates the session's guest player on the first request without a valid cookie. */
export async function requirePlayer(ctx: Ctx): Promise<PlayerRow> {
  const existing = await sessionPlayer(ctx);
  if (existing !== null) return existing;
  const player = await createPlayer(await freeGuestName(), 1, false);
  const sessionId = randomBytes(24).toString('base64url');
  await query('insert into sessions (id, player_id) values ($1, $2)', [sessionId, player.id]);
  ctx.setSession(sessionId);
  return player;
}

export async function sessionPlayer(ctx: Ctx): Promise<PlayerRow | null> {
  if (ctx.sessionId === null) return null;
  return one<PlayerRow>(
    `${SELECT_PLAYER} where id = (select player_id from sessions where id = $1)`,
    [ctx.sessionId],
  );
}

export async function playerForSessionId(sessionId: string): Promise<PlayerRow | null> {
  return one<PlayerRow>(
    `${SELECT_PLAYER} where id = (select player_id from sessions where id = $1)`,
    [sessionId],
  );
}

export async function newSessionFor(playerId: string): Promise<string> {
  const sessionId = randomBytes(24).toString('base64url');
  await query('insert into sessions (id, player_id) values ($1, $2)', [sessionId, playerId]);
  return sessionId;
}

export async function chalkBalance(playerId: string): Promise<number> {
  const row = await one<{ sum: string | null }>(
    "select sum(delta)::text as sum from ledger_entries where player_id = $1 and account = 'player'",
    [playerId],
  );
  return row === null || row.sum === null ? 0 : Number(row.sum);
}

export async function equippedFor(playerId: string): Promise<{ striker: string; board: string; coins: string }> {
  const row = await one<{ striker: string; board: string; coins: string }>(
    'select striker, board, coins from equipped_items where player_id = $1',
    [playerId],
  );
  return row ?? { ...DEFAULT_EQUIPPED };
}

export async function ownedFor(playerId: string): Promise<string[]> {
  const rows = await query<{ item_id: string }>(
    'select item_id from owned_items where player_id = $1',
    [playerId],
  );
  return rows.map((row) => row.item_id);
}

export async function meBody(player: PlayerRow): Promise<Record<string, unknown>> {
  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    chosen: player.chosen,
    email: player.email,
    linked: player.email !== null,
    rating: round2(player.rating),
    rd: round2(player.rd),
    tier: tierOf(player.rating),
    rankedGames: player.ranked_games,
    chalk: await chalkBalance(player.id),
    equipped: await equippedFor(player.id),
  };
}

async function freeSuggestions(name: string, blocked: boolean): Promise<string[]> {
  const candidates = suggestionCandidates(name, blocked);
  const rows = await query<{ name_lower: string }>(
    'select name_lower from players where name_lower = any($1)',
    [candidates.map((candidate) => candidate.toLowerCase())],
  );
  const taken = new Set(rows.map((row) => row.name_lower));
  return candidates.filter((candidate) => !taken.has(candidate.toLowerCase())).slice(0, 3);
}

export async function setName(player: PlayerRow, name: string, avatar: number | null): Promise<PlayerRow> {
  const problem = nameShapeProblem(name);
  if (problem === 'NAME_INVALID') throw unprocessable('NAME_INVALID');
  if (problem === 'NAME_BLOCKED') {
    throw unprocessable('NAME_BLOCKED', { suggestions: await freeSuggestions(name, true) });
  }
  if (avatar !== null && (!Number.isInteger(avatar) || avatar < 1 || avatar > 24)) {
    throw unprocessable('AVATAR_INVALID');
  }
  const clash = await one<{ id: string }>(
    'select id from players where name_lower = $1 and id <> $2',
    [name.toLowerCase(), player.id],
  );
  if (clash !== null) {
    throw new ApiError(409, 'NAME_TAKEN', { suggestions: await freeSuggestions(name, false) });
  }
  await query(
    'update players set name = $2, name_lower = $3, avatar = coalesce($4, avatar), chosen = true where id = $1',
    [player.id, name, name.toLowerCase(), avatar],
  );
  const row = await playerById(player.id);
  if (row === null) throw notFound();
  return row;
}

export async function skipName(player: PlayerRow): Promise<PlayerRow> {
  const name = /^Guest-\d{4}$/.test(player.name) ? player.name : await freeGuestName();
  await query('update players set name = $2, name_lower = $3, chosen = true where id = $1', [
    player.id,
    name,
    name.toLowerCase(),
  ]);
  const row = await playerById(player.id);
  if (row === null) throw notFound();
  return row;
}

export async function setAvatar(player: PlayerRow, avatar: number): Promise<PlayerRow> {
  if (!Number.isInteger(avatar) || avatar < 1 || avatar > 24) throw unprocessable('AVATAR_INVALID');
  await query('update players set avatar = $2 where id = $1', [player.id, avatar]);
  const row = await playerById(player.id);
  if (row === null) throw notFound();
  return row;
}

export async function createNamedPlayer(input: {
  name: string;
  avatar: number;
  email: string | null;
  rating: number;
  rd: number;
  volatility: number;
  rankedGames: number;
}): Promise<PlayerRow> {
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `insert into players (id, name, name_lower, avatar, chosen, email, rating, rd, volatility, ranked_games)
       values ($1, $2, $3, $4, true, $5, $6, $7, $8, $9)`,
      [
        id,
        input.name,
        input.name.toLowerCase(),
        input.avatar,
        input.email,
        input.rating,
        input.rd,
        input.volatility,
        input.rankedGames,
      ],
    );
    await client.query(
      'insert into equipped_items (player_id, striker, board, coins) values ($1, $2, $3, $4)',
      [id, DEFAULT_EQUIPPED.striker, DEFAULT_EQUIPPED.board, DEFAULT_EQUIPPED.coins],
    );
    for (const itemId of FREE_ITEM_IDS) {
      await client.query('insert into owned_items (player_id, item_id) values ($1, $2)', [id, itemId]);
    }
  });
  const row = await playerById(id);
  if (row === null) throw notFound();
  return row;
}
