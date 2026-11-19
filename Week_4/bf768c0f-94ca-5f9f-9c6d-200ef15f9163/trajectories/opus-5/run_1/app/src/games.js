/**
 * Games: reading one, playing into one, ending one and undoing one.
 * Everything here reads the stored rows and writes back through them.
 */

import {
  START_FEN, playMove, parseFen, positionKey, terminalState, availableClaims,
  legalMovesUci, boardSquares, hasInsufficientMaterial, IllegalMove,
} from './chess.js';
import { houseMove, isLevel } from './house.js';
import { openingFor } from './record.js';
import { applyResult } from './ratings.js';
import { ratingDisplay } from './ratings.js';
import { publicMember, housePlayer, avatarUrl } from './members.js';
import { newId, transaction, UNIQUE_VIOLATION } from './db.js';
import { config } from './config.js';

export class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const NOT_HERE = 'That game is not here.';

export function notFound() {
  return new Refusal(404, NOT_HERE);
}

const GAME_COLUMNS = 'g.*';

export async function fetchGame(client, gameId, { lock = false } = {}) {
  if (typeof gameId !== 'string' || gameId.length === 0 || gameId.length > 80) return null;
  const sql = `select ${GAME_COLUMNS} from games g where g.id = $1${lock ? ' for update' : ''}`;
  const result = await client.query(sql, [gameId]);
  return result.rows[0] || null;
}

export async function fetchMembersByIds(client, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  const result = await client.query('select * from members where id = any($1::text[])', [wanted]);
  return new Map(result.rows.map((row) => [row.id, row]));
}

export async function fetchMoves(client, gameId) {
  const result = await client.query(
    'select ply, uci, san, fen_after, announcement, created_at from moves where game_id = $1 order by ply asc',
    [gameId],
  );
  return result.rows;
}

/** Is this a game only its owner may see: a house game or a study game? */
export function isSolo(game) {
  return !game.white_id || !game.black_id || game.white_id === game.black_id;
}

export function isPlayer(game, memberId) {
  if (!memberId) return false;
  return game.white_id === memberId || game.black_id === memberId;
}

/** The side a member plays, or null for a spectator. */
export function sideOf(game, memberId) {
  if (!memberId) return null;
  if (game.white_id === memberId && game.black_id === memberId) return 'both';
  if (game.white_id === memberId) return 'white';
  if (game.black_id === memberId) return 'black';
  return null;
}

export function houseSide(game) {
  if (game.white_id && game.black_id) return null;
  if (!game.white_id && !game.black_id) return null;
  return game.white_id ? 'black' : 'white';
}

/**
 * May this member see the game at all?  A game inside a private club answers
 * a non-member exactly as a game that does not exist.
 */
export async function canSee(client, game, member) {
  if (!member) return false;
  if (isPlayer(game, member.id)) return true;
  if (isSolo(game)) return false;
  if (game.club_id) {
    const club = await client.query('select * from clubs where id = $1', [game.club_id]);
    const row = club.rows[0];
    if (row && row.private) {
      const membership = await client.query(
        'select 1 from club_memberships where club_id = $1 and member_id = $2 and banned = false',
        [game.club_id, member.id],
      );
      return membership.rowCount > 0;
    }
  }
  return true;
}

/** The repetition keys of every position the game has stood in, current included. */
export function historyKeys(game, moves) {
  const keys = [positionKey(game.start_fen || START_FEN)];
  for (const move of moves) keys.push(positionKey(move.fen_after));
  return keys;
}

function playerObject(member) {
  if (!member) return housePlayer();
  return {
    id: member.id,
    username: member.username,
    rating: member.rating,
    rating_display: ratingDisplay(member.rating, member.rated_games),
    rated_games: member.rated_games,
    avatar_url: avatarUrl(member),
  };
}

/** The one JSON object every game endpoint returns. */
export async function gameObject(client, game, { moves = null } = {}) {
  const movesRows = moves || await fetchMoves(client, game.id);
  const members = await fetchMembersByIds(client, [game.white_id, game.black_id, game.draw_offer_by, game.takeback_by]);
  const white = game.white_id ? members.get(game.white_id) : null;
  const black = game.black_id ? members.get(game.black_id) : null;
  const inProgress = game.status === 'in_progress';
  const claims = inProgress
    ? availableClaims(game.fen, historyKeys(game, movesRows))
    : { threefold: false, 'fifty-move': false };

  let club = null;
  if (game.club_id) {
    const row = await client.query('select id, name, slug, private from clubs where id = $1', [game.club_id]);
    club = row.rows[0] || null;
  }

  return {
    id: game.id,
    game_id: game.id,
    fen: game.fen,
    start_fen: game.start_fen,
    turn: parseFen(game.fen).turn === 'w' ? 'white' : 'black',
    status: game.status,
    result: game.status === 'aborted' ? '' : game.result,
    end_reason: game.status === 'finished' ? game.end_reason : null,
    rated: game.rated,
    level: game.level,
    opening: game.opening,
    club: club ? { name: club.name, slug: club.slug, private: club.private } : null,
    white: playerObject(white),
    black: playerObject(black),
    moves: movesRows.map((move) => ({
      ply: move.ply,
      uci: move.uci,
      san: move.san,
      fen_after: move.fen_after,
      announcement: move.announcement,
      created_at: move.created_at,
    })),
    draw_offer_by: game.draw_offer_by ? (members.get(game.draw_offer_by)?.username ?? null) : null,
    takeback_by: game.takeback_by ? (members.get(game.takeback_by)?.username ?? null) : null,
    claims: { threefold: claims.threefold, 'fifty-move': claims['fifty-move'] },
    legal_moves: inProgress ? legalMovesUci(parseFen(game.fen)) : [],
    squares: boardSquares(game.fen),
    last_move: movesRows.length
      ? { uci: movesRows[movesRows.length - 1].uci, from: movesRows[movesRows.length - 1].uci.slice(0, 2), to: movesRows[movesRows.length - 1].uci.slice(2, 4) }
      : null,
    created_at: game.created_at,
    last_move_at: game.last_move_at,
    finished_at: game.finished_at,
  };
}

// ---------------------------------------------------------------------------
// Finishing a game
// ---------------------------------------------------------------------------

async function lockMembers(client, ids) {
  const wanted = [...new Set(ids.filter(Boolean))].sort();
  if (!wanted.length) return new Map();
  const result = await client.query(
    'select * from members where id = any($1::text[]) order by id for update',
    [wanted],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

/**
 * Settle a result: store it and, when the game is rated between two members,
 * move both ratings from the numbers they held before the game.
 */
export async function finishGame(client, game, { result, reason }) {
  const ratedPair = game.rated && game.white_id && game.black_id && game.white_id !== game.black_id;
  let ratings = null;
  if (ratedPair) {
    const members = await lockMembers(client, [game.white_id, game.black_id]);
    const white = members.get(game.white_id);
    const black = members.get(game.black_id);
    ratings = applyResult({ white, black, result });
    await client.query(
      'update members set rating = $2, rated_games = $3 where id = $1',
      [white.id, ratings.white.rating_after, ratings.white.rated_games_after],
    );
    await client.query(
      'update members set rating = $2, rated_games = $3 where id = $1',
      [black.id, ratings.black.rating_after, ratings.black.rated_games_after],
    );
    await client.query(
      `update games set status = 'finished', result = $2, end_reason = $3, finished_at = now(),
         draw_offer_by = null, takeback_by = null,
         white_rating_before = $4, black_rating_before = $5,
         white_rated_games_before = $6, black_rated_games_before = $7
       where id = $1`,
      [
        game.id, result, reason,
        ratings.white.rating_before, ratings.black.rating_before,
        ratings.white.rated_games_before, ratings.black.rated_games_before,
      ],
    );
  } else {
    await client.query(
      `update games set status = 'finished', result = $2, end_reason = $3, finished_at = now(),
         draw_offer_by = null, takeback_by = null where id = $1`,
      [game.id, result, reason],
    );
  }
  return ratings;
}

// ---------------------------------------------------------------------------
// Deadlines, settled when the game is next read
// ---------------------------------------------------------------------------

export async function settleDeadlines(gameId) {
  return transaction(async (client) => {
    const game = await fetchGame(client, gameId, { lock: true });
    if (!game || game.status !== 'in_progress') return game;
    const moves = await fetchMoves(client, gameId);
    const now = Date.now();

    if (moves.length === 0) {
      const age = (now - new Date(game.created_at).getTime()) / 1000;
      if (age > config.firstMoveAbortSec) {
        await client.query(
          `update games set status = 'aborted', result = '', end_reason = null, rated = false,
             draw_offer_by = null, takeback_by = null, finished_at = now() where id = $1`,
          [game.id],
        );
        return fetchGame(client, gameId);
      }
      return game;
    }

    const idle = (now - new Date(game.last_move_at).getTime()) / 1000;
    if (idle > config.moveDeadlineSec) {
      const turn = parseFen(game.fen).turn;
      await finishGame(client, game, { result: turn === 'w' ? '0-1' : '1-0', reason: 'deadline' });
      return fetchGame(client, gameId);
    }
    return game;
  });
}

// ---------------------------------------------------------------------------
// Playing a move
// ---------------------------------------------------------------------------

async function notify(client, { memberId, kind, gameId = null, actorId = null }) {
  if (!memberId || memberId === actorId) return;
  await client.query(
    'insert into notifications (id, member_id, kind, game_id, actor_id) values ($1, $2, $3, $4, $5)',
    [newId(), memberId, kind, gameId, actorId],
  );
}

async function storeMove(client, game, ply, played) {
  try {
    await client.query(
      `insert into moves (id, game_id, ply, uci, san, fen_after, announcement)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [newId(), game.id, ply, played.uci, played.san, played.fen, played.announcement],
    );
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Refusal(409, 'The position has moved on: another move was played for this turn.');
    }
    throw error;
  }
}

async function afterMoveState(client, game, moves) {
  const fen = moves[moves.length - 1].fen_after;
  const keys = historyKeys({ ...game, start_fen: game.start_fen }, moves);
  return { fen, keys, state: terminalState(fen, keys) };
}

/**
 * Submit one move.  `expectedFen` is the position the caller was looking at:
 * when the stored game has moved past it, the move is refused and the
 * position is untouched.
 */
export async function submitMove(gameId, member, uci, expectedFen) {
  return transaction(async (client) => {
    const game = await fetchGame(client, gameId, { lock: true });
    if (!game) throw notFound();
    if (!await canSee(client, game, member)) throw notFound();
    if (!isPlayer(game, member.id)) {
      throw new Refusal(403, 'Only the two players of this game may move in it.');
    }
    if (game.status !== 'in_progress') {
      throw new Refusal(409, 'This game has finished.');
    }
    if (expectedFen && expectedFen !== game.fen) {
      throw new Refusal(409, 'The position has moved on: your board was out of date.');
    }

    const side = sideOf(game, member.id);
    const turn = parseFen(game.fen).turn === 'w' ? 'white' : 'black';
    if (side !== 'both' && side !== turn) {
      throw new Refusal(409, 'It is not your turn.');
    }

    let played;
    try {
      played = playMove(game.fen, uci);
    } catch (error) {
      if (error instanceof IllegalMove) throw new Refusal(422, `${uci} is not a legal move in this position.`);
      throw new Refusal(422, 'That move could not be read.');
    }

    const existing = await fetchMoves(client, game.id);
    const ply = existing.length + 1;
    await storeMove(client, game, ply, played);
    const moves = [...existing, { ply, uci: played.uci, san: played.san, fen_after: played.fen, announcement: played.announcement }];

    let fen = played.fen;
    let opening = openingFor(moves.map((m) => m.uci)) || game.opening;
    await client.query(
      `update games set fen = $2, opening = $3, last_move_at = now(), draw_offer_by = null, takeback_by = null
       where id = $1`,
      [game.id, fen, opening],
    );

    // The opponent hears about it.
    const opponentId = game.white_id === member.id ? game.black_id : game.white_id;
    if (opponentId && opponentId !== member.id) {
      await notify(client, { memberId: opponentId, kind: 'move', gameId: game.id, actorId: member.id });
    }

    let after = await afterMoveState(client, { ...game, fen }, moves);
    if (after.state.over) {
      await finishGame(client, { ...game, fen }, { result: after.state.result, reason: after.state.reason });
      const settled = await fetchGame(client, game.id);
      return { game: await gameObject(client, settled), houseReply: null };
    }

    // In a house game, or a study game given a level, the house answers now.
    const house = houseSide({ ...game });
    let houseReply = null;
    if (house && isLevel(game.level)) {
      const toMove = parseFen(fen).turn === 'w' ? 'white' : 'black';
      if (toMove === house) {
        const reply = houseMove(fen, game.level);
        if (reply) {
          const housePlayed = playMove(fen, reply);
          await storeMove(client, { ...game, fen }, ply + 1, housePlayed);
          moves.push({
            ply: ply + 1, uci: housePlayed.uci, san: housePlayed.san,
            fen_after: housePlayed.fen, announcement: housePlayed.announcement,
          });
          fen = housePlayed.fen;
          opening = openingFor(moves.map((m) => m.uci)) || opening;
          await client.query(
            'update games set fen = $2, opening = $3, last_move_at = now() where id = $1',
            [game.id, fen, opening],
          );
          houseReply = housePlayed;
          after = await afterMoveState(client, { ...game, fen }, moves);
          if (after.state.over) {
            await finishGame(client, { ...game, fen }, { result: after.state.result, reason: after.state.reason });
          }
        }
      }
    }

    const settled = await fetchGame(client, game.id);
    return { game: await gameObject(client, settled), houseReply };
  });
}

/** Create a game row. */
export async function createGame(client, {
  id = newId(), whiteId, blackId, clubId = null, rated = false, level = null,
  startFen = START_FEN,
}) {
  const result = await client.query(
    `insert into games (id, white_id, black_id, club_id, rated, level, fen, start_fen, status, result)
     values ($1, $2, $3, $4, $5, $6, $7, $7, 'in_progress', '*')
     on conflict (id) do nothing
     returning *`,
    [id, whiteId, blackId, clubId, rated, level, startFen],
  );
  if (result.rows[0]) return result.rows[0];
  return fetchGame(client, id);
}
