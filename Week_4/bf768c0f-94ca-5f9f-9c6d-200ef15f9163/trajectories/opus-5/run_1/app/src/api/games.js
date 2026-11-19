/**
 * Everything that happens to a game: moves, draws, takebacks, resignation,
 * the record, the chat beside the board and the house opponent.
 */

import express from 'express';
import { pool, query, one, newId, transaction, derivedId } from '../db.js';
import { config } from '../config.js';
import {
  Refusal, route, fail, bodyObject, requireString, requireMember, requireBoolean, requireOneOf, sendArray,
} from '../http.js';
import {
  fetchGame, fetchMoves, fetchMembersByIds, canSee, isPlayer, sideOf, houseSide, gameObject,
  historyKeys, settleDeadlines, finishGame, submitMove, createGame, notFound, isSolo,
} from '../games.js';
import {
  parseFen, toFen, legalMovesUci, availableClaims, terminalState, positionKey, START_FEN, playMove,
  InvalidFen,
} from '../chess.js';
import { houseMove, isLevel, LEVELS } from '../house.js';
import { exportRecord, importRecord, openingFor, InvalidRecord } from '../record.js';
import { avatarUrl, HOUSE_USERNAME } from '../members.js';
import { encodeCursor, decodeCursor, pageLimit } from '../security.js';

export const router = express.Router();

/** Load a game the caller may see, settling its deadlines first. */
async function viewableGame(req, { lock = false } = {}) {
  const member = requireMember(req);
  const gameId = req.params.game_id;
  await settleDeadlines(gameId);
  const game = await fetchGame(pool, gameId, { lock });
  if (!game) throw notFound();
  if (!await canSee(pool, game, member)) throw notFound();
  return { game, member };
}

async function playerGame(req) {
  const { game, member } = await viewableGame(req);
  if (!isPlayer(game, member.id)) {
    fail(403, 'Only the two players of this game may do that.');
  }
  return { game, member };
}

async function respondGame(res, gameId, status = 200) {
  const game = await fetchGame(pool, gameId);
  res.status(status).json(await gameObject(pool, game));
}

router.get('/games/:game_id', route(async (req, res) => {
  const { game } = await viewableGame(req);
  res.json(await gameObject(pool, game));
}));

router.get('/games/:game_id/legal-moves', route(async (req, res) => {
  const { game } = await viewableGame(req);
  if (game.status !== 'in_progress') return sendArray(res, []);
  sendArray(res, legalMovesUci(parseFen(game.fen)));
}));

router.post('/games/:game_id/moves', route(async (req, res) => {
  const member = requireMember(req);
  const body = bodyObject(req);
  const uci = requireString(body.move, 'move', { min: 4, max: 5 });
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    fail(422, 'A move is written as four characters, or five for a promotion, such as e2e4 or e7e8q.');
  }
  const expectedFen = typeof body.fen === 'string' ? body.fen : null;
  await settleDeadlines(req.params.game_id);
  const result = await submitMove(req.params.game_id, member, uci, expectedFen);
  res.status(201).json(result.game);
}));

router.post('/games/from-fen', route(async (req, res) => {
  const member = requireMember(req);
  const body = bodyObject(req);
  const fenText = requireString(body.fen, 'fen', { max: 120 });
  let position;
  try {
    position = parseFen(fenText);
  } catch (error) {
    if (error instanceof InvalidFen) fail(422, `That position record cannot be read: ${error.message}.`);
    throw error;
  }
  const fen = toFen(position);
  let level = null;
  if (body.level !== undefined && body.level !== null) {
    level = requireOneOf(body.level, LEVELS, 'level');
  }

  const toMove = position.turn === 'w' ? 'white' : 'black';
  const game = await transaction(async (client) => {
    const created = await createGame(client, {
      id: newId(),
      whiteId: level ? (toMove === 'white' ? member.id : null) : member.id,
      blackId: level ? (toMove === 'black' ? member.id : null) : member.id,
      rated: false,
      level,
      startFen: fen,
    });
    const state = terminalState(fen, [positionKey(fen)]);
    if (state.over) {
      await finishGame(client, created, { result: state.result, reason: state.reason });
      return fetchGame(client, created.id);
    }
    return created;
  });
  res.status(201).json(await gameObject(pool, game));
}));

router.post('/computer-games', route(async (req, res) => {
  const member = requireMember(req);
  const body = bodyObject(req);
  const level = requireOneOf(body.level, LEVELS, 'level');
  let colour = 'white';
  if (body.colour !== undefined && body.colour !== null) {
    colour = requireOneOf(body.colour, ['white', 'black'], 'colour');
  }

  const game = await transaction(async (client) => {
    const created = await createGame(client, {
      id: newId(),
      whiteId: colour === 'white' ? member.id : null,
      blackId: colour === 'black' ? member.id : null,
      rated: false,
      level,
      startFen: START_FEN,
    });
    if (colour === 'black') {
      const reply = houseMove(created.fen, level);
      const played = playMove(created.fen, reply);
      await client.query(
        `insert into moves (id, game_id, ply, uci, san, fen_after, announcement)
         values ($1, $2, 1, $3, $4, $5, $6)`,
        [newId(), created.id, played.uci, played.san, played.fen, played.announcement],
      );
      await client.query(
        'update games set fen = $2, opening = $3, last_move_at = now() where id = $1',
        [created.id, played.fen, openingFor([played.uci])],
      );
      return fetchGame(client, created.id);
    }
    return created;
  });
  res.status(201).json(await gameObject(pool, game));
}));

// ---------------------------------------------------------------------------
// Draw offers and claims
// ---------------------------------------------------------------------------

router.post('/games/:game_id/draw-offer', route(async (req, res) => {
  const member = requireMember(req);
  await settleDeadlines(req.params.game_id);
  await transaction(async (client) => {
    const game = await fetchGame(client, req.params.game_id, { lock: true });
    if (!game || !await canSee(client, game, member)) throw notFound();
    if (!isPlayer(game, member.id)) fail(403, 'Only the two players of this game may offer a draw.');
    if (game.status !== 'in_progress') fail(409, 'This game has finished.');
    if (game.draw_offer_by) fail(409, 'A draw offer is already open.');
    const side = sideOf(game, member.id);
    const turn = parseFen(game.fen).turn === 'w' ? 'white' : 'black';
    if (side !== 'both' && side !== turn) fail(409, 'A draw may only be offered on your own turn.');
    await client.query('update games set draw_offer_by = $2 where id = $1', [game.id, member.id]);
  });
  await respondGame(res, req.params.game_id);
}));

router.post('/games/:game_id/draw-response', route(async (req, res) => {
  const member = requireMember(req);
  const accept = requireBoolean(bodyObject(req).accept, 'accept');
  await settleDeadlines(req.params.game_id);
  await transaction(async (client) => {
    const game = await fetchGame(client, req.params.game_id, { lock: true });
    if (!game || !await canSee(client, game, member)) throw notFound();
    if (!isPlayer(game, member.id)) fail(403, 'Only the two players of this game may answer a draw offer.');
    if (game.status !== 'in_progress') fail(409, 'This game has finished.');
    if (!game.draw_offer_by) fail(409, 'There is no draw offer to answer.');
    if (game.draw_offer_by === member.id && sideOf(game, member.id) !== 'both') {
      fail(403, 'Your opponent answers your own offer.');
    }
    if (accept) {
      await finishGame(client, game, { result: '1/2-1/2', reason: 'agreement' });
    } else {
      await client.query('update games set draw_offer_by = null where id = $1', [game.id]);
    }
  });
  await respondGame(res, req.params.game_id);
}));

router.post('/games/:game_id/claim', route(async (req, res) => {
  const member = requireMember(req);
  const kind = requireOneOf(bodyObject(req).kind, ['threefold', 'fifty-move'], 'kind');
  await settleDeadlines(req.params.game_id);
  await transaction(async (client) => {
    const game = await fetchGame(client, req.params.game_id, { lock: true });
    if (!game || !await canSee(client, game, member)) throw notFound();
    if (!isPlayer(game, member.id)) fail(403, 'Only the two players of this game may claim a draw.');
    if (game.status !== 'in_progress') fail(409, 'This game has finished.');
    const moves = await fetchMoves(client, game.id);
    const claims = availableClaims(game.fen, historyKeys(game, moves));
    if (!claims[kind]) {
      fail(409, kind === 'threefold'
        ? 'This position has not stood three times, so there is nothing to claim.'
        : 'Fifty moves have not passed without a capture or a pawn move.');
    }
    await finishGame(client, game, {
      result: '1/2-1/2',
      reason: kind === 'threefold' ? 'threefold claim' : 'fifty-move claim',
    });
  });
  await respondGame(res, req.params.game_id);
}));

// ---------------------------------------------------------------------------
// Takebacks
// ---------------------------------------------------------------------------

router.post('/games/:game_id/takeback', route(async (req, res) => {
  const member = requireMember(req);
  await settleDeadlines(req.params.game_id);
  await transaction(async (client) => {
    const game = await fetchGame(client, req.params.game_id, { lock: true });
    if (!game || !await canSee(client, game, member)) throw notFound();
    if (!isPlayer(game, member.id)) fail(403, 'Only the two players of this game may ask for a takeback.');
    if (game.status !== 'in_progress') fail(409, 'This game has finished.');
    if (game.takeback_by) fail(409, 'A takeback request is already open.');
    const moves = await fetchMoves(client, game.id);
    if (!moves.length) fail(409, 'No move has been played yet.');
    await client.query('update games set takeback_by = $2 where id = $1', [game.id, member.id]);
  });
  await respondGame(res, req.params.game_id);
}));

router.post('/games/:game_id/takeback-response', route(async (req, res) => {
  const member = requireMember(req);
  const accept = requireBoolean(bodyObject(req).accept, 'accept');
  await settleDeadlines(req.params.game_id);
  await transaction(async (client) => {
    const game = await fetchGame(client, req.params.game_id, { lock: true });
    if (!game || !await canSee(client, game, member)) throw notFound();
    if (!isPlayer(game, member.id)) fail(403, 'Only the two players of this game may answer a takeback.');
    if (game.status !== 'in_progress') fail(409, 'This game has finished.');
    if (!game.takeback_by) fail(409, 'There is no takeback request to answer.');
    const solo = isSolo(game);
    if (game.takeback_by === member.id && !solo) {
      fail(403, 'Your opponent answers your own request.');
    }
    if (!accept) {
      await client.query('update games set takeback_by = null where id = $1', [game.id]);
      return;
    }

    const moves = await fetchMoves(client, game.id);
    if (!moves.length) fail(409, 'No move has been played yet.');
    const requesterSide = sideOf(game, game.takeback_by);
    // Undo back to the requester's own turn: their move, and the reply to it.
    const lastMoverSide = moves.length % 2 === 1 ? 'white' : 'black';
    let undo = 1;
    if (requesterSide !== 'both' && lastMoverSide !== requesterSide) undo = 2;
    undo = Math.min(undo, moves.length);
    const keep = moves.length - undo;
    await client.query('delete from moves where game_id = $1 and ply > $2', [game.id, keep]);
    const remaining = moves.slice(0, keep);
    const fen = keep === 0 ? game.start_fen : remaining[remaining.length - 1].fen_after;
    await client.query(
      `update games set fen = $2, opening = $3, takeback_by = null, draw_offer_by = null, last_move_at = now()
       where id = $1`,
      [game.id, fen, openingFor(remaining.map((m) => m.uci))],
    );
  });
  await respondGame(res, req.params.game_id);
}));

// ---------------------------------------------------------------------------
// Resignation and rematch
// ---------------------------------------------------------------------------

router.post('/games/:game_id/resign', route(async (req, res) => {
  const member = requireMember(req);
  await settleDeadlines(req.params.game_id);
  await transaction(async (client) => {
    const game = await fetchGame(client, req.params.game_id, { lock: true });
    if (!game || !await canSee(client, game, member)) throw notFound();
    if (!isPlayer(game, member.id)) fail(403, 'Only the two players of this game may resign it.');
    if (game.status !== 'in_progress') fail(409, 'This game has finished.');
    const side = sideOf(game, member.id);
    const loser = side === 'both' ? (parseFen(game.fen).turn === 'w' ? 'white' : 'black') : side;
    await finishGame(client, game, {
      result: loser === 'white' ? '0-1' : '1-0',
      reason: 'resignation',
    });
  });
  await respondGame(res, req.params.game_id);
}));

router.post('/games/:game_id/rematch', route(async (req, res) => {
  const member = requireMember(req);
  const { game } = await playerGame(req);
  if (game.status === 'in_progress') fail(409, 'This game is still being played.');

  const created = await transaction(async (client) => {
    const next = await createGame(client, {
      id: newId(),
      whiteId: game.black_id,
      blackId: game.white_id,
      clubId: game.club_id,
      rated: game.rated,
      level: game.level,
      startFen: START_FEN,
    });
    const house = houseSide(next);
    if (house === 'white' && isLevel(next.level)) {
      const played = playMove(next.fen, houseMove(next.fen, next.level));
      await client.query(
        `insert into moves (id, game_id, ply, uci, san, fen_after, announcement)
         values ($1, $2, 1, $3, $4, $5, $6)`,
        [newId(), next.id, played.uci, played.san, played.fen, played.announcement],
      );
      await client.query('update games set fen = $2, opening = $3 where id = $1', [
        next.id, played.fen, openingFor([played.uci]),
      ]);
      return fetchGame(client, next.id);
    }
    return next;
  });
  res.status(201).json(await gameObject(pool, created));
}));

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

async function recordFor(game) {
  const moves = await fetchMoves(pool, game.id);
  const members = await fetchMembersByIds(pool, [game.white_id, game.black_id]);
  return exportRecord({
    white_username: game.white_id ? members.get(game.white_id).username : HOUSE_USERNAME,
    black_username: game.black_id ? members.get(game.black_id).username : HOUSE_USERNAME,
    result: game.status === 'aborted' ? '*' : game.result,
    created_at: game.created_at,
  }, moves);
}

router.get('/games/:game_id/record', route(async (req, res) => {
  const { game } = await viewableGame(req);
  const text = await recordFor(game);
  res.type('text/plain; charset=utf-8');
  if (req.query.download !== undefined) {
    res.setHeader('Content-Disposition', `attachment; filename="gambit-hall-${game.id}.pgn"`);
  }
  res.send(text);
}));

export { recordFor };

router.post('/games/import', route(async (req, res) => {
  const member = requireMember(req);
  const text = requireString(bodyObject(req).record, 'record', { max: 200_000 });
  let imported;
  try {
    imported = importRecord(text);
  } catch (error) {
    if (error instanceof InvalidRecord) fail(422, `That record cannot be read: ${error.message}.`);
    throw error;
  }

  const game = await transaction(async (client) => {
    const created = await createGame(client, {
      id: newId(),
      whiteId: member.id,
      blackId: member.id,
      rated: false,
      startFen: START_FEN,
    });
    for (let i = 0; i < imported.moves.length; i++) {
      const move = imported.moves[i];
      await client.query(
        `insert into moves (id, game_id, ply, uci, san, fen_after, announcement)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [newId(), created.id, i + 1, move.uci, move.san, move.fen_after, move.announcement],
      );
    }
    await client.query('update games set fen = $2, opening = $3 where id = $1', [
      created.id, imported.fen, imported.opening,
    ]);
    const keys = [positionKey(START_FEN), ...imported.moves.map((m) => positionKey(m.fen_after))];
    const state = terminalState(imported.fen, keys);
    const row = await fetchGame(client, created.id);
    if (state.over) {
      await finishGame(client, row, { result: state.result, reason: state.reason });
    }
    return fetchGame(client, created.id);
  });
  res.status(201).json(await gameObject(pool, game));
}));

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

async function chatRows(gameId, { limit, cursor }) {
  const params = [gameId];
  let where = 'c.game_id = $1';
  if (cursor) {
    params.push(cursor.created_at, cursor.id);
    where += ` and (c.created_at, c.id) > ($${params.length - 1}::timestamptz, $${params.length})`;
  }
  params.push(limit + 1);
  const result = await query(
    `select c.id, c.member_id, c.text, c.created_at, m.username, m.avatar_key,
            to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_key
       from chat_messages c join members m on m.id = c.member_id
      where ${where} order by c.created_at asc, c.id asc limit $${params.length}`,
    params,
  );
  return result.rows;
}

router.get('/games/:game_id/chat', route(async (req, res) => {
  const { game, member } = await viewableGame(req);
  if (!isPlayer(game, member.id)) {
    fail(403, 'A game\'s chat is for its two players.');
  }
  const limit = pageLimit(req.query.limit, 50, 100);
  const cursor = decodeCursor(req.query.cursor);
  const rows = await chatRows(game.id, { limit, cursor });
  const page = rows.slice(0, limit);
  const next = rows.length > limit && page.length
    ? encodeCursor({ created_at: page[page.length - 1].created_at_key, id: page[page.length - 1].id })
    : null;
  sendArray(res, page.map((row) => ({
    id: row.id,
    game_id: game.id,
    member_id: row.member_id,
    username: row.username,
    avatar_url: avatarUrl({ id: row.member_id, avatar_key: row.avatar_key }),
    text: row.text,
    created_at: row.created_at,
  })), { nextCursor: next });
}));

router.post('/games/:game_id/chat', route(async (req, res) => {
  const member = requireMember(req);
  const body = bodyObject(req);
  if (typeof body.text !== 'string') fail(422, 'A message must be text.');
  const text = body.text;
  if (text.trim() === '') fail(422, 'A message cannot be empty.');
  if (text.length > 500) fail(422, 'A message may be at most 500 characters.');

  await settleDeadlines(req.params.game_id);
  const game = await fetchGame(pool, req.params.game_id);
  if (!game) throw notFound();
  if (!await canSee(pool, game, member)) throw notFound();
  if (!isPlayer(game, member.id)) fail(403, 'A game\'s chat is for its two players.');

  const opponentId = game.white_id === member.id ? game.black_id : game.white_id;
  if (opponentId && opponentId !== member.id) {
    const blocked = await one(
      'select 1 from blocks where blocker_id = $1 and blocked_id = $2',
      [opponentId, member.id],
    );
    if (blocked) fail(403, 'That member has blocked you.');
  }

  const recent = await one(
    `select count(*)::int as count from chat_messages
      where member_id = $1 and created_at > now() - interval '10 seconds'`,
    [member.id],
  );
  if (recent.count >= config.chatRateLimit) {
    fail(429, 'You are sending messages too quickly. Wait a moment.');
  }

  const row = await one(
    `insert into chat_messages (id, game_id, member_id, text) values ($1, $2, $3, $4)
     returning id, member_id, text, created_at`,
    [newId(), game.id, member.id, text],
  );
  if (opponentId && opponentId !== member.id) {
    await query(
      'insert into notifications (id, member_id, kind, game_id, actor_id) values ($1, $2, $3, $4, $5)',
      [newId(), opponentId, 'chat', game.id, member.id],
    );
  }
  res.status(201).json({
    id: row.id,
    game_id: game.id,
    member_id: member.id,
    username: member.username,
    avatar_url: avatarUrl(member),
    text: row.text,
    created_at: row.created_at,
  });
}));
