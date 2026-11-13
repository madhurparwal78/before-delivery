import { AVATAR_COUNT, BLOCKED_WORDS } from "./catalog";
import type { ItemKind } from "./catalog";
import { query, uniqueViolation } from "./db";
import type { Row } from "./db";
import { ApiError } from "./errors";
import { tierOf, twoDecimals } from "./ratings";
import { hashToken, newToken, randomBelow } from "./util";

/** Players, sessions, names, the profile views and the leaderboard. */

export type Runner = (sql: string, params?: unknown[]) => Promise<Row[]>;

export interface Player {
  id: string;
  name: string;
  avatar: number;
  chosen: boolean;
  email: string | null;
  rating: number;
  rd: number;
  volatility: number;
  rankedGames: number;
  equipped: Record<ItemKind, string>;
}

const NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export function toPlayer(row: Row): Player {
  return {
    id: row.id as string,
    name: row.name as string,
    avatar: row.avatar as number,
    chosen: row.chosen as boolean,
    email: (row.email as string | null) ?? null,
    rating: row.rating as number,
    rd: row.rd as number,
    volatility: row.volatility as number,
    rankedGames: row.ranked_games as number,
    equipped: { striker: row.equipped_striker as string, board: row.equipped_board as string, coins: row.equipped_coins as string },
  };
}

export async function playerById(id: string, run: Runner = query): Promise<Player | null> {
  const found = await run("SELECT * FROM players WHERE id = $1", [id]);
  return found[0] ? toPlayer(found[0]) : null;
}

export async function playerByName(name: string): Promise<Player | null> {
  // Guest names carry a hyphen, so the chosen-name pattern is too strict here; refuse what no name can hold before the lookup.
  if (name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  const found = await query("SELECT * FROM players WHERE name_key = $1", [name.toLowerCase()]);
  return found[0] ? toPlayer(found[0]) : null;
}

export async function playerBySession(token: string): Promise<Player | null> {
  const found = await query(
    "SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = $1",
    [hashToken(token)],
  );
  return found[0] ? toPlayer(found[0]) : null;
}

export async function openSession(playerId: string): Promise<string> {
  const token = newToken();
  await query("INSERT INTO sessions (token_hash, player_id) VALUES ($1, $2)", [hashToken(token), playerId]);
  return token;
}

export async function createGuest(): Promise<Player> {
  for (;;) {
    const name = `New-${newToken().slice(0, 10)}`;
    try {
      const made = await query("INSERT INTO players (name, name_key) VALUES ($1, $2) RETURNING *", [name, name.toLowerCase()]);
      return toPlayer(made[0] as Row);
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
    }
  }
}

export async function chalkBalance(playerId: string, run: Runner = query): Promise<number> {
  const sum = await run("SELECT COALESCE(SUM(delta), 0)::int AS sum FROM ledger WHERE player_id = $1 AND account = 'player'", [playerId]);
  return (sum[0]?.sum as number | undefined) ?? 0;
}

export async function meJson(player: Player): Promise<Record<string, unknown>> {
  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    chosen: player.chosen,
    email: player.email,
    linked: player.email !== null,
    rating: twoDecimals(player.rating),
    rd: twoDecimals(player.rd),
    tier: tierOf(twoDecimals(player.rating)),
    rankedGames: player.rankedGames,
    chalk: await chalkBalance(player.id),
    equipped: player.equipped,
  };
}

function blockedName(name: string): boolean {
  const lower = name.toLowerCase();
  return BLOCKED_WORDS.some((word) => lower.includes(word));
}

async function freeSuggestions(base: string, exclude: string): Promise<string[]> {
  const found: string[] = [];
  for (let n = 1; n <= 99 && found.length < 3; n++) {
    const candidate = `${base}_${String(n).padStart(2, "0")}`;
    const taken = await query("SELECT id FROM players WHERE name_key = $1 AND id <> $2", [candidate.toLowerCase(), exclude]);
    if (taken.length === 0) found.push(candidate);
  }
  return found;
}

export async function chooseName(player: Player, name: string, avatar: number | undefined): Promise<void> {
  if (avatar !== undefined && (!Number.isInteger(avatar) || avatar < 1 || avatar > AVATAR_COUNT)) {
    throw new ApiError(422, "AVATAR_INVALID");
  }
  if (!NAME_PATTERN.test(name)) throw new ApiError(422, "NAME_INVALID");
  const taken = await query("SELECT id FROM players WHERE name_key = $1 AND id <> $2", [name.toLowerCase(), player.id]);
  if (taken.length > 0) throw new ApiError(409, "NAME_TAKEN", { suggestions: await freeSuggestions(name.slice(0, 13), player.id) });
  if (blockedName(name)) throw new ApiError(422, "NAME_BLOCKED", { suggestions: await freeSuggestions("Player", player.id) });
  try {
    await query("UPDATE players SET name = $2, name_key = $3, chosen = true, avatar = COALESCE($4, avatar) WHERE id = $1", [
      player.id,
      name,
      name.toLowerCase(),
      avatar ?? null,
    ]);
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    throw new ApiError(409, "NAME_TAKEN", { suggestions: await freeSuggestions(name.slice(0, 13), player.id) });
  }
}

export async function skipName(player: Player): Promise<void> {
  for (let attempt = 0; attempt < 10000; attempt++) {
    const name = `Guest-${String(attempt < 200 ? randomBelow(10000) : attempt % 10000).padStart(4, "0")}`;
    try {
      await query("UPDATE players SET name = $2, name_key = $3, chosen = true WHERE id = $1", [player.id, name, name.toLowerCase()]);
      return;
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
    }
  }
  throw new ApiError(409, "NAME_TAKEN");
}

export async function setAvatar(player: Player, avatar: unknown): Promise<void> {
  if (typeof avatar !== "number" || !Number.isInteger(avatar) || avatar < 1 || avatar > AVATAR_COUNT) {
    throw new ApiError(422, "AVATAR_INVALID");
  }
  await query("UPDATE players SET avatar = $2 WHERE id = $1", [player.id, avatar]);
}

export function publicPlayerJson(player: Player): Record<string, unknown> {
  const rating = twoDecimals(player.rating);
  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    rating,
    rd: twoDecimals(player.rd),
    tier: tierOf(rating),
    rankedGames: player.rankedGames,
  };
}

export async function historyJson(playerId: string): Promise<Record<string, unknown>> {
  const found = await query(
    `SELECT m.id, m.mode, m.format, m.state, m.seat0, m.seat1, m.opponent_name, m.ended_at,
            o.name AS opponent, rc.delta
       FROM matches m
       LEFT JOIN players o ON o.id = CASE WHEN m.seat0 = $1 THEN m.seat1 ELSE m.seat0 END
       LEFT JOIN rating_changes rc ON rc.match_id = m.id AND rc.player_id = $1
      WHERE (m.seat0 = $1 OR m.seat1 = $1) AND m.status IN ('completed', 'forfeit')
      ORDER BY m.ended_at DESC NULLS LAST, m.created_at DESC
      LIMIT 50`,
    [playerId],
  );
  return {
    matches: found.map((row) => {
      const seat = row.seat0 === playerId ? 0 : 1;
      const state = row.state as { scores: [number, number]; winnerSeat: number; endReason: string; format: string };
      return {
        matchId: row.id,
        mode: row.mode,
        format: row.format,
        opponent: row.mode === "local" ? row.opponent_name : row.opponent,
        result: state.winnerSeat === seat ? "won" : "lost",
        yourScore: state.scores[seat],
        theirScore: state.scores[seat === 0 ? 1 : 0],
        ratingDelta: row.delta === null || row.delta === undefined ? null : twoDecimals(row.delta as number),
        endReason: state.endReason,
        endedAt: row.ended_at instanceof Date ? row.ended_at.toISOString() : null,
      };
    }),
  };
}

const LEADERBOARD_ROW = `SELECT p.id, p.name, p.rating, p.ranked_games FROM players p
   WHERE p.ranked_games >= 10 AND p.rd < 150 ORDER BY p.rating DESC, p.id LIMIT 100`;

function leaderRow(rank: number, row: Row): Record<string, unknown> {
  const rating = twoDecimals(row.rating as number);
  return { rank, playerId: row.id, name: row.name, rating, tier: tierOf(rating), rankedGames: row.ranked_games };
}

export async function leaderboardJson(viewer: Player): Promise<Record<string, unknown>> {
  const top = await query(LEADERBOARD_ROW);
  const rowsOut = top.map((row, index) => leaderRow(index + 1, row));
  if (rowsOut.some((r) => r.playerId === viewer.id)) return { rows: rowsOut, you: null };
  const ahead = await query(
    "SELECT COUNT(*)::int AS ahead FROM players WHERE ranked_games >= 10 AND rd < 150 AND rating > $1",
    [viewer.rating],
  );
  const rank = ((ahead[0]?.ahead as number | undefined) ?? 0) + 1;
  return {
    rows: rowsOut,
    you: leaderRow(rank, { id: viewer.id, name: viewer.name, rating: viewer.rating, ranked_games: viewer.rankedGames }),
  };
}
