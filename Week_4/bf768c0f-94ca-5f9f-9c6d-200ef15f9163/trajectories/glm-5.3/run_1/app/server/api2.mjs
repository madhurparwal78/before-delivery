// The rest of the API: draws, claims, takebacks, resign, rematch, records, chat,
// challenges, clubs, members, leaderboard, notifications, blocks, admin void.
import { query, withTransaction } from '../lib/db.mjs';
import { hashPassword, verifyPassword, newToken, hashToken, newId, lockConfig, chatRateLimit } from '../lib/auth.mjs';
import { parseFen, legalMoves, applyMove, toFen, statusOf, insufficientMaterial, START_FEN, repetitionCount } from '../lib/chess.mjs';
import { sanFor, announcementFor, openingFor } from '../lib/san.mjs';
import { houseMove } from '../lib/house.mjs';
import { clampRating } from '../lib/rating.mjs';
import {
  memberById, memberByUsername, canSeeGame, isPlayer, playerColour, claimsFor,
  positionHistory, notify, shapeMember, shapeGame, loadGame, houseSide,
  settleGame, applyRatingChange, replayRatings, moveFromUci, uciOfMove,
} from '../lib/games.mjs';
import { buildRecord, parseRecord } from '../lib/record.mjs';
import { err, json, requireJson, requireMember, gamePayload, plyBeforeFen, HttpError } from './api-helpers.mjs';

const houseMemberId = () => 'mem_the_house';

async function getGameOrRefuse(req, gameId) {
  const member = await requireMember(req);
  const loaded = await loadGame(gameId);
  if (!loaded || !(await canSeeGame(member, loaded.game))) err(404, 'That game is not here.');
  const settled = await withTransaction(async client => settleGame(client, loaded.game));
  return { member, game: settled, loaded };
}

async function requirePlayer(req, gameId) {
  const { member, game } = await getGameOrRefuse(req, gameId);
  const colour = playerColour(member, game);
  if (!colour) err(403, 'You are not a player in this game.');
  if (game.white_id === game.black_id) {
    // solo study game: the creator plays both colours
    return { member, game, colour: parseFen(game.fen).turn === 'w' ? 'white' : 'black' };
  }
  return { member, game, colour };
}

// ---------------------------------------------------------------- draws

async function apiDrawOffer(req, res, gameId) {
  const { member, game, colour } = await requirePlayer(req, gameId);
  if (game.status !== 'in_progress') err(409, 'This game is over.');
  const turn = parseFen(game.fen).turn === 'w' ? 'white' : 'black';
  if (turn !== colour) err(409, 'A draw offer is made on your own turn.');
  if (game.draw_offer_by) err(409, 'A draw offer is already open.');
  await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [gameId]);
    if (lock.rows[0].draw_offer_by) err(409, 'A draw offer is already open.');
    await client.query('UPDATE games SET draw_offer_by=$2 WHERE id=$1', [gameId, member.username]);
  });
  json(res, 200, await gamePayload((await query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0]));
}

async function apiDrawResponse(req, res, gameId) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  if (typeof body.accept !== 'boolean') err(422, 'Accept or decline the offer.');
  const { game } = await getGameOrRefuse(req, gameId);
  const colour = playerColour(member, game);
  if (!colour) err(403, 'You are not a player in this game.');
  const updated = await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [gameId]);
    const g = lock.rows[0];
    if (g.status !== 'in_progress') err(409, 'This game is over.');
    if (!g.draw_offer_by) err(409, 'No draw offer is open.');
    if (g.draw_offer_by === member.username) err(409, 'Wait for your opponent to answer.');
    if (body.accept) {
      const r = await client.query(
        `UPDATE games SET status='finished', result='1/2-1/2', end_reason='agreement',
           draw_offer_by=NULL, last_move_at=now() WHERE id=$1 AND status='in_progress' RETURNING *`,
        [gameId]
      );
      if (r.rowCount > 0 && r.rows[0].rated && r.rows[0].black_id !== null && r.rows[0].white_id !== r.rows[0].black_id) {
        await applyRatingChange(client, gameId);
      }
      return r.rows[0];
    }
    const r = await client.query('UPDATE games SET draw_offer_by=NULL WHERE id=$1 RETURNING *', [gameId]);
    return r.rows[0];
  });
  json(res, 200, await gamePayload(updated));
}

async function apiClaim(req, res, gameId) {
  const { member, game, colour } = await requirePlayer(req, gameId);
  const body = await requireJson(req);
  if (body.kind !== 'threefold' && body.kind !== 'fifty-move') err(422, 'A claim is threefold or fifty-move.');
  const updated = await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [gameId]);
    const g = lock.rows[0];
    if (g.status !== 'in_progress') err(409, 'This game is over.');
    const moveFens = (await client.query('SELECT fen_after FROM moves WHERE game_id=$1 ORDER BY ply', [gameId])).rows.map(r => r.fen_after);
    const claims = claimsFor(g, moveFens);
    if (!claims[body.kind]) err(409, `The ${body.kind === 'threefold' ? 'threefold' : 'fifty-move'} condition does not hold yet.`);
    const reason = body.kind === 'threefold' ? 'threefold claim' : 'fifty-move claim';
    const r = await client.query(
      `UPDATE games SET status='finished', result='1/2-1/2', end_reason=$2, last_move_at=now()
       WHERE id=$1 AND status='in_progress' RETURNING *`,
      [gameId, reason]
    );
    if (r.rowCount > 0 && r.rows[0].rated && r.rows[0].black_id !== null && r.rows[0].white_id !== r.rows[0].black_id) {
      await applyRatingChange(client, gameId);
    }
    return r.rows[0];
  });
  json(res, 200, await gamePayload(updated));
}

// ---------------------------------------------------------------- takebacks

async function apiTakeback(req, res, gameId) {
  const { member, game } = await requirePlayer(req, gameId);
  if (game.status !== 'in_progress') err(409, 'This game is over.');
  if (game.takeback_by) err(409, 'A takeback request is already open.');
  await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [gameId]);
    const g = lock.rows[0];
    if (g.status !== 'in_progress' && g.takeback_by) err(409, 'A takeback request is already open.');
    const moveCount = Number((await client.query('SELECT count(*) AS n FROM moves WHERE game_id=$1', [gameId])).rows[0].n);
    if (moveCount === 0) err(409, 'There is no move to take back.');
    await client.query('UPDATE games SET takeback_by=$2 WHERE id=$1', [gameId, member.username]);
  });
  json(res, 200, await gamePayload((await query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0]));
}

async function apiTakebackResponse(req, res, gameId) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  if (typeof body.accept !== 'boolean') err(422, 'Accept or decline the request.');
  const updated = await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [gameId]);
    const g = lock.rows[0];
    if (!g || !(await canSeeGame(member, g))) err(404, 'That game is not here.');
    if (g.status !== 'in_progress') err(409, 'This game is over.');
    if (!g.takeback_by) err(409, 'No takeback request is open.');
    if (g.takeback_by === member.username) err(409, 'Wait for your opponent to answer.');
    if (!body.accept) {
      const r = await client.query('UPDATE games SET takeback_by=NULL WHERE id=$1 RETURNING *', [gameId]);
      return r.rows[0];
    }
    // accepting restores the position: remove the last move of the requester
    const last = (await client.query('SELECT * FROM moves WHERE game_id=$1 ORDER BY ply DESC LIMIT 1', [gameId])).rows[0];
    if (!last) err(409, 'There is no move to take back.');
    await client.query('DELETE FROM moves WHERE game_id=$1 AND ply=$2', [gameId, last.ply]);
    const prev = (await client.query('SELECT fen_after FROM moves WHERE game_id=$1 ORDER BY ply DESC LIMIT 1', [gameId])).rows[0];
    const restoredFen = prev ? prev.fen_after : (g.fen_start || START_FEN);
    await client.query(
      `UPDATE games SET fen=$2, takeback_by=NULL, draw_offer_by=NULL, last_move_at=now() WHERE id=$1`,
      [gameId, restoredFen]
    );
    const allUci = (await client.query('SELECT uci FROM moves WHERE game_id=$1 ORDER BY ply', [gameId])).rows.map(r => r.uci);
    await client.query('UPDATE games SET opening=$2 WHERE id=$1', [gameId, openingFor(allUci)]);
    return (await client.query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0];
  });
  json(res, 200, await gamePayload(updated));
}

// ---------------------------------------------------------------- resign, rematch

async function apiResign(req, res, gameId) {
  const { member, game, colour } = await requirePlayer(req, gameId);
  if (game.status !== 'in_progress') err(409, 'This game is over.');
  const updated = await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [gameId]);
    const g = lock.rows[0];
    if (g.status !== 'in_progress') err(409, 'This game is over.');
    if (g.white_id === g.black_id) err(409, 'A study game is not resigned.');
    const loserColour = playerColour(member, g);
    if (!loserColour) err(403, 'You are not a player in this game.');
    const result = loserColour === 'white' ? '0-1' : '1-0';
    const r = await client.query(
      `UPDATE games SET status='finished', result=$2, end_reason='resignation',
         draw_offer_by=NULL, takeback_by=NULL, last_move_at=now()
       WHERE id=$1 AND status='in_progress' RETURNING *`,
      [gameId, result]
    );
    if (r.rowCount > 0 && r.rows[0].rated && r.rows[0].black_id !== null && r.rows[0].white_id !== r.rows[0].black_id) {
      await applyRatingChange(client, gameId);
    }
    return r.rows[0];
  });
  json(res, 200, await gamePayload(updated));
}

async function apiRematch(req, res, gameId) {
  const member = await requireMember(req);
  const { game } = await getGameOrRefuse(req, gameId);
  const colour = playerColour(member, game);
  if (!colour) err(403, 'You are not a player in this game.');
  if (game.white_id === game.black_id) err(403, 'A study game has no rematch.');
  if (game.white_id === houseMemberId() || game.black_id === houseMemberId()) err(409, 'The house does not take rematches.');
  if (game.status !== 'finished') err(409, 'Finish this game before a rematch.');
  const newGameId = newId('game');
  await query(
    `INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, fen_start, status, result, created_at, last_move_at)
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$6,'in_progress','*',now(),now())`,
    [newGameId, game.black_id, game.white_id, game.club_id, game.rated, START_FEN]
  );
  const created = (await query('SELECT * FROM games WHERE id=$1', [newGameId])).rows[0];
  json(res, 201, await gamePayload(created));
}

// ---------------------------------------------------------------- records

async function apiGetRecord(req, res, gameId) {
  const { game, loaded } = await getGameOrRefuse(req, gameId);
  const white = loaded.white;
  const black = loaded.black && loaded.black.id !== houseMemberId() ? loaded.black : houseSide();
  const record = buildRecord(game, loaded.moves, white ? white.username : 'The house', black ? black.username : 'The house');
  json(res, 200, { record, game_id: gameId });
}

async function apiImportRecord(req, res) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  if (typeof body.record !== 'string' || !body.record.trim()) err(422, 'A record is required.');
  const parsed = parseRecord(body.record);
  if (!parsed.ok) {
    const first = parsed.errors[0];
    err(422, `Line ${first.line}: ${first.message}`);
  }
  const gameId = newId('import');
  const whiteName = parsed.tags.White || 'White';
  const blackName = parsed.tags.Black || 'Black';
  const white = await memberByUsername(whiteName);
  const black = await memberByUsername(blackName);
  await query(
    `INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, fen_start, status, result, end_reason, opening, created_at, last_move_at)
     VALUES ($1,$2,$3,NULL,FALSE,NULL,$4,$5,$6,$7,$8,$9, now(), now())`,
    [gameId, white ? white.id : member.id, black ? black.id : member.id,
     parsed.finalFen, START_FEN, parsed.status.over ? 'finished' : 'in_progress',
     parsed.status.over ? parsed.status.result : '*',
     parsed.status.over ? parsed.status.reason : null,
     parsed.opening]
  );
  // store the replayed moves
  let fen = START_FEN;
  for (let i = 0; i < parsed.uciMoves.length; i++) {
    const uci = parsed.uciMoves[i];
    const san = sanFor(fen, uci);
    const pos = parseFen(fen);
    const mv = legalMoves(pos).find(m => uciOfMove(m) === uci);
    const after = applyMove(pos, mv);
    await query(
      `INSERT INTO moves (game_id, ply, uci, san, fen_after, created_at)
       VALUES ($1,$2,$3,$4,$5, now()) ON CONFLICT (game_id, ply) DO NOTHING`,
      [gameId, i + 1, uci, san, toFen(after)]
    );
    fen = toFen(after);
  }
  json(res, 201, await gamePayload((await query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0]));
}

// ---------------------------------------------------------------- chat

async function apiGetChat(req, res, gameId) {
  const member = await requireMember(req);
  const loaded = await loadGame(gameId);
  if (!loaded || !(await canSeeGame(member, loaded.game))) err(404, 'That game is not here.');
  // only the two players may read the chat
  const g = loaded.game;
  const isPlayerIn = g.white_id === member.id || g.black_id === member.id;
  if (!isPlayerIn) err(403, 'The chat is for the two players.');
  const limit = Math.min(parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '200', 10) || 200, 200);
  const cursor = new URL(req.url, 'http://x').searchParams.get('cursor');
  const params = [gameId];
  let where = 'game_id = $1';
  if (cursor) { where += ' AND id > $2'; params.push(decodeOpaque(cursor, 'chat')); }
  const rows = await query(`SELECT * FROM chat_messages WHERE ${where} ORDER BY id ASC LIMIT $${params.length + 1}`, [...params, limit + 1]);
  const messages = rows.rows.slice(0, limit);
  const next = rows.rows.length > limit ? encodeOpaque(['chat', messages[messages.length - 1].id]) : null;
  const shaped = [];
  for (const m of messages) {
    const sender = await memberById(m.member_id);
    shaped.push({
      id: m.id, text: m.text, created_at: m.created_at,
      sender: sender ? {
        username: sender.username,
        avatar_url: sender.username === 'The house' ? '/media/avatars/house.svg'
          : (sender.avatar_key && sender.avatar_key.startsWith('uploaded:')
            ? `/media/avatars/${sender.id}.png` : `/media/avatars/${sender.avatar_key}.svg`),
      } : null,
    });
  }
  json(res, 200, shaped, next ? { 'Next-Cursor': next } : {});
}

async function apiPostChat(req, res, gameId) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  const text = typeof body.text === 'string' ? body.text : null;
  if (text === null) err(422, 'A message is text.');
  if (text.trim().length === 0) err(422, 'A message cannot be empty.');
  if (text.length > 500) err(422, 'A message is at most 500 characters.');
  const loaded = await loadGame(gameId);
  if (!loaded || !(await canSeeGame(member, loaded.game))) err(404, 'That game is not here.');
  const g = loaded.game;
  if (g.white_id !== member.id && g.black_id !== member.id) err(403, 'The chat is for the two players.');
  // blocking: a blocked member may not chat the blocker
  const opponentId = g.white_id === member.id ? g.black_id : g.white_id;
  const blocked = await query('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [opponentId, member.id]);
  if (blocked.rowCount > 0) err(403, 'You cannot chat this member.');
  // rate limit: CHAT_RATE_LIMIT messages in 10 seconds
  const limit = chatRateLimit();
  const recent = await query(
    'SELECT count(*) AS n FROM chat_messages WHERE member_id=$1 AND created_at > now() - interval \'10 seconds\'',
    [member.id]
  );
  if (Number(recent.rows[0].n) >= limit) err(429, 'That is too many messages at once.');
  const inserted = await query(
    'INSERT INTO chat_messages (game_id, member_id, text, created_at) VALUES ($1,$2,$3, now()) RETURNING *',
    [gameId, member.id, text]
  );
  if (opponentId && opponentId !== member.id) {
    await withTransaction(async client => notify(client, opponentId, 'chat', gameId));
  }
  json(res, 201, {
    id: inserted.rows[0].id,
    text: inserted.rows[0].text,
    created_at: inserted.rows[0].created_at,
    sender: { username: member.username, avatar_url: member.avatar_key.startsWith('uploaded:') ? `/media/avatars/${member.id}.png` : `/media/avatars/${member.avatar_key}.svg` },
  });
}

// ---------------------------------------------------------------- challenges

async function apiListChallenges(req, res) {
  const member = await requireMember(req);
  const rows = await query(
    `SELECT c.*, wf.username AS from_username, wt.username AS to_username, cl.slug AS club_slug
     FROM challenges c
     JOIN members wf ON wf.id = c.from_id
     JOIN members wt ON wt.id = c.to_id
     LEFT JOIN clubs cl ON cl.id = c.club_id
     WHERE (c.from_id = $1 OR c.to_id = $1)
     ORDER BY c.created_at DESC`, [member.id]
  );
  json(res, 200, rows.rows.map(c => ({
    id: c.id,
    from: c.from_username,
    to: c.to_username,
    rated: c.rated,
    colour: c.colour,
    club: c.club_slug,
    status: c.status,
    game_id: c.game_id || null,
    created_at: c.created_at,
  })));
}

async function apiCreateChallenge(req, res) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  const opponentName = typeof body.opponent === 'string' ? body.opponent : '';
  const opponent = await memberByUsername(opponentName);
  if (!opponent) err(422, 'Choose an opponent by username.');
  if (opponent.id === member.id) err(422, 'You cannot challenge yourself.');
  if (opponent.id === houseMemberId()) err(422, 'The house plays from /play, not by challenge.');
  const rated = typeof body.rated === 'boolean' ? body.rated : false;
  const colour = body.colour;
  if (!['White', 'Black', 'Random'].includes(colour)) err(422, 'A colour is White, Black or Random.');
  let club = null;
  if (body.club !== undefined && body.club !== null) {
    club = (await query('SELECT * FROM clubs WHERE slug=$1', [String(body.club)])).rows[0];
    if (!club) err(422, 'That club does not exist.');
    const membership = (await query('SELECT * FROM club_memberships WHERE club_id=$1 AND member_id=$2', [club.id, member.id])).rows[0];
    if (!membership || membership.banned) err(403, 'You cannot challenge through that club.');
  }
  // blocking: the blocked member cannot challenge the blocker
  const blocked = await query('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [opponent.id, member.id]);
  if (blocked.rowCount > 0) err(403, 'You cannot challenge this member.');
  const id = newId('chal');
  await query(
    `INSERT INTO challenges (id, from_id, to_id, club_id, rated, colour, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',now())`,
    [id, member.id, opponent.id, club ? club.id : null, rated, colour]
  );
  await withTransaction(async client => notify(client, opponent.id, 'challenge', null));
  json(res, 201, {
    id, from: member.username, to: opponent.username, rated, colour,
    club: club ? club.slug : null, status: 'pending', game_id: null,
  });
}

async function apiAcceptChallenge(req, res, challengeId) {
  const member = await requireMember(req);
  const idemKey = req.headers['idempotency-key'] || null;
  const created = await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM challenges WHERE id=$1 FOR UPDATE', [challengeId]);
    const ch = lock.rows[0];
    if (!ch) err(404, 'That challenge is not here.');
    // visibility: only its two members may act on a challenge
    if (ch.to_id !== member.id && ch.from_id !== member.id) err(404, 'That challenge is not here.');
    if (ch.to_id !== member.id) err(403, 'This challenge is yours to send, not to accept.');
    // a replay under the same idempotency key returns the same game
    if (ch.status === 'accepted') {
      if (idemKey && ch.idempotency_key && ch.idempotency_key.split(':')[0] === idemKey && ch.game_id) {
        return { replay: ch.game_id };
      }
      err(409, 'This challenge has already been accepted.');
    }
    if (ch.status !== 'pending') err(409, 'This challenge is no longer open.');
    const fromMember = await memberById(ch.from_id);
    // a blocked member cannot challenge: check the block still stands
    const blocked = await client.query('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [ch.to_id, ch.from_id]);
    if (blocked.rowCount > 0) err(403, 'This member cannot challenge you.');
    if (ch.club_id) {
      const membership = (await client.query('SELECT * FROM club_memberships WHERE club_id=$1 AND member_id=$2', [ch.club_id, ch.from_id])).rows[0];
      if (membership && membership.banned) err(403, 'That member is banned from this club.');
    }
    // colours: the colour the form sent is the colour the game carries
    let fromColour = ch.colour === 'White' ? 'white' : ch.colour === 'Black' ? 'black' : (Math.random() < 0.5 ? 'white' : 'black');
    const gameId = newId('game');
    const whiteId = fromColour === 'white' ? ch.from_id : ch.to_id;
    const blackId = fromColour === 'white' ? ch.to_id : ch.from_id;
    await client.query(
      `INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, fen_start, status, result, created_at, last_move_at)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$6,'in_progress','*',now(),now())`,
      [gameId, whiteId, blackId, ch.club_id, ch.rated, START_FEN]
    );
    await client.query(
      `UPDATE challenges SET status='accepted', game_id=$2, idempotency_key=$3 WHERE id=$1`,
      [challengeId, gameId, idemKey ? `${idemKey}:${gameId}` : null]
    );
    return { gameId };
  });
  if (created.replay) {
    const g = (await query('SELECT * FROM games WHERE id=$1', [created.replay])).rows[0];
    return json(res, 201, await gamePayload(g));
  }
  const g = (await query('SELECT * FROM games WHERE id=$1', [created.gameId])).rows[0];
  json(res, 201, await gamePayload(g));
}

async function apiDeclineChallenge(req, res, challengeId) {
  const member = await requireMember(req);
  const updated = await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM challenges WHERE id=$1 FOR UPDATE', [challengeId]);
    const ch = lock.rows[0];
    if (!ch || (ch.to_id !== member.id && ch.from_id !== member.id)) err(404, 'That challenge is not here.');
    if (ch.to_id !== member.id) err(403, 'This challenge is yours to send, not to decline.');
    if (ch.status === 'accepted') err(409, 'This challenge has already been accepted.');
    if (ch.status !== 'pending') err(409, 'This challenge is no longer open.');
    const r = await client.query(
      `UPDATE challenges SET status='declined' WHERE id=$1 AND status='pending' RETURNING *`,
      [challengeId]
    );
    return r.rows[0];
  });
  json(res, 200, { id: updated.id, status: updated.status });
}

// ---------------------------------------------------------------- clubs

async function apiListClubs(req, res) {
  const member = await requireMember(req);
  const rows = await query(
    `SELECT c.*, 
       (SELECT count(*) FROM club_memberships m WHERE m.club_id = c.id AND m.banned = FALSE) AS member_count
     FROM clubs c ORDER BY c.name`
  );
  const visible = [];
  for (const club of rows.rows) {
    if (club.private) {
      const m = await query('SELECT 1 FROM club_memberships WHERE club_id=$1 AND member_id=$2 AND banned=FALSE', [club.id, member.id]);
      if (m.rowCount === 0) continue;
    }
    visible.push({
      id: club.id, name: club.name, slug: club.slug, private: club.private,
      member_count: Number(club.member_count),
    });
  }
  json(res, 200, visible);
}

async function apiGetClub(req, res, slug) {
  const member = await requireMember(req);
  const club = (await query('SELECT * FROM clubs WHERE slug=$1', [slug])).rows[0];
  if (!club) err(404, 'That club is not here.');
  if (club.private) {
    const m = await query('SELECT 1 FROM club_memberships WHERE club_id=$1 AND member_id=$2 AND banned=FALSE', [club.id, member.id]);
    if (m.rowCount === 0) err(404, 'That club is not here.');
  }
  const members = await query(
    `SELECT m.username, m.rating, m.avatar_key, m.id, cm.role, cm.banned
     FROM club_memberships cm JOIN members m ON m.id = cm.member_id
     WHERE cm.club_id=$1 ORDER BY cm.role, m.username`, [club.id]
  );
  json(res, 200, {
    id: club.id, name: club.name, slug: club.slug, private: club.private,
    members: members.rows.map(r => ({
      username: r.username, rating: r.rating, role: r.role, banned: r.banned,
      avatar_url: r.avatar_key && r.avatar_key.startsWith('uploaded:') ? `/media/avatars/${r.id}.png` : `/media/avatars/${r.avatar_key}.svg`,
    })),
  });
}

// ---------------------------------------------------------------- members & leaderboard

function encodeOpaque(parts) {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}
function decodeOpaque(cursor, kind) {
  try {
    const parts = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!Array.isArray(parts) || parts[0] !== kind) err(422, 'That cursor is not valid.');
    return parts[1];
  } catch (e) {
    if (e instanceof HttpError) throw e;
    err(422, 'That cursor is not valid.');
  }
}

async function apiListMembers(req, res) {
  const member = await requireMember(req);
  const url = new URL(req.url, 'http://x');
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);
  const cursor = url.searchParams.get('cursor');
  const params = [];
  let where = 'username <> $1';
  params.push('The house');
  if (q) { where += ' AND username ILIKE $2'; params.push(`%${q}%`); }
  if (cursor) { where += ` AND username > $${params.length + 1}`; params.push(decodeOpaque(cursor, 'members')); }
  const rows = await query(
    `SELECT * FROM members WHERE ${where} ORDER BY username ASC LIMIT $${params.length + 1}`,
    [...params, limit + 1]
  );
  const page = rows.rows.slice(0, limit);
  const next = rows.rows.length > limit ? encodeOpaque(['members', page[page.length - 1].username]) : null;
  json(res, 200, page.map(shapeMember));
}

async function apiGetMember(req, res, username) {
  const member = await requireMember(req);
  const target = await memberByUsername(username);
  if (!target) err(404, 'That member is not here.');
  if (target.id === houseMemberId()) err(404, 'That member is not here.');
  // wins/losses/draws split by colour, derived from stored games
  const games = await query(
    `SELECT * FROM games WHERE (white_id=$1 OR black_id=$1) AND status='finished' AND white_id <> black_id`, [target.id]
  );
  const tally = { wins: { white: 0, black: 0 }, losses: { white: 0, black: 0 }, draws: { white: 0, black: 0 } };
  for (const g of games.rows) {
    const colour = g.white_id === target.id ? 'white' : 'black';
    const mine = g.result === '1-0' ? 'white' : g.result === '0-1' ? 'black' : 'draw';
    if (mine === 'draw') tally.draws[colour] += 1;
    else if (mine === colour) tally.wins[colour] += 1;
    else tally.losses[colour] += 1;
  }
  json(res, 200, {
    ...shapeMember(target),
    wins: tally.wins, losses: tally.losses, draws: tally.draws,
  });
}

async function apiMemberGames(req, res, username) {
  const member = await requireMember(req);
  const target = await memberByUsername(username);
  if (!target) err(404, 'That member is not here.');
  const url = new URL(req.url, 'http://x');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);
  const cursor = url.searchParams.get('cursor');
  const params = [target.id];
  let where = `(g.white_id = $1 OR g.black_id = $1) AND g.status = 'finished' AND g.white_id <> g.black_id`;
  if (cursor) {
    const [lastDate, lastId] = decodeOpaque(cursor, 'member_games');
    where += ` AND (g.last_move_at, g.id) < ($2::timestamptz, $3)`;
    params.push(new Date(lastDate).toISOString(), String(lastId));
  }
  const rows = await query(
    `SELECT g.* FROM games g WHERE ${where} ORDER BY g.last_move_at DESC, g.id DESC LIMIT $${params.length + 1}`,
    [...params, limit + 1]
  );
  const page = rows.rows.slice(0, limit);
  const next = rows.rows.length > limit && page.length
    ? encodeOpaque(['member_games', new Date(page[page.length - 1].last_move_at).toISOString(), page[page.length - 1].id])
    : null;
  const out = [];
  for (const g of page) {
    const opponentId = g.white_id === target.id ? g.black_id : g.white_id;
    const opponent = await memberById(opponentId);
    const colour = g.white_id === target.id ? 'White' : 'Black';
    out.push({
      game_id: g.id,
      opponent: opponent ? opponent.username : 'The house',
      colour,
      result: g.result,
      reason: g.end_reason,
      rated: g.rated,
      finished_at: g.last_move_at,
    });
  }
  json(res, 200, { games: out, next_cursor: next });
}

async function apiLeaderboard(req, res) {
  await requireMember(req);
  const url = new URL(req.url, 'http://x');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);
  const cursor = url.searchParams.get('cursor');
  const params = ['The house'];
  let where = 'username <> $1';
  if (cursor) {
    const c = decodeOpaque(cursor, 'leaderboard');
    // cursor carries the (rating, games, username) triple to continue after
    const [rating, games, username] = c;
    where += ` AND (rating, rated_games, username) < ($2, $3, $4)`;
    params.push(Number(rating), Number(games), String(username));
  }
  const rows = await query(
    `SELECT * FROM members WHERE ${where} ORDER BY rating DESC, rated_games DESC, username ASC LIMIT $${params.length + 1}`,
    [...params, limit + 1]
  );
  const page = rows.rows.slice(0, limit);
  const next = rows.rows.length > limit && page.length
    ? encodeOpaque(['leaderboard', [page[page.length - 1].rating, page[page.length - 1].rated_games, page[page.length - 1].username]])
    : null;
  json(res, 200, {
    members: page.map((m, i) => shapeMember(m, { rank: i + 1 })),
    next_cursor: next,
  });
}

// ---------------------------------------------------------------- notifications

async function apiNotifications(req, res) {
  const member = await requireMember(req);
  const rows = await query(
    'SELECT * FROM notifications WHERE member_id=$1 ORDER BY id DESC LIMIT 100', [member.id]
  );
  const unread = await query('SELECT count(*) AS n FROM notifications WHERE member_id=$1 AND read=FALSE', [member.id]);
  const out = [];
  for (const n of rows.rows) {
    let from = null;
    if (n.kind === 'challenge') {
      // the challenge notification names the challenger: the most recent challenge
      // this member received on or before the notification was written
      const c = await query(
        `SELECT wf.username FROM challenges ch JOIN members wf ON wf.id = ch.from_id
         WHERE ch.to_id = $1 AND ch.created_at <= $2::timestamptz + interval '1 second'
         ORDER BY ch.created_at DESC LIMIT 1`,
        [member.id, n.created_at]
      );
      from = c.rows[0]?.username || null;
    } else if (n.kind === 'move' && n.game_id) {
      const g = (await query('SELECT * FROM games WHERE id=$1', [n.game_id])).rows[0];
      if (g) {
        const other = g.white_id === member.id ? g.black_id : g.white_id;
        if (other) from = (await memberById(other))?.username || null;
      }
    } else if (n.kind === 'chat' && n.game_id) {
      const m = await query(
        'SELECT mm.username FROM chat_messages cm JOIN members mm ON mm.id = cm.member_id WHERE cm.game_id=$1 AND cm.member_id <> $2 ORDER BY cm.id DESC LIMIT 1',
        [n.game_id, member.id]
      );
      from = m.rows[0]?.username || null;
    }
    out.push({
      id: n.id, kind: n.kind, game_id: n.game_id, read: n.read, created_at: n.created_at,
      from,
    });
  }
  json(res, 200, { notifications: out, unread: Number(unread.rows[0].n) });
}

async function apiMarkRead(req, res, notificationId) {
  const member = await requireMember(req);
  const n = await query('SELECT * FROM notifications WHERE id=$1 AND member_id=$2', [notificationId, member.id]);
  if (n.rowCount === 0) err(404, 'That notification is not here.');
  await query('UPDATE notifications SET read=TRUE WHERE id=$1 AND member_id=$2', [notificationId, member.id]);
  const unread = await query('SELECT count(*) AS n FROM notifications WHERE member_id=$1 AND read=FALSE', [member.id]);
  json(res, 200, { unread: Number(unread.rows[0].n) });
}

// ---------------------------------------------------------------- blocks

async function apiBlock(req, res) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  const target = await memberByUsername(typeof body.username === 'string' ? body.username : '');
  if (!target) err(422, 'Choose a member to block by username.');
  if (target.id === member.id) err(422, 'You cannot block yourself.');
  await query(
    'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [member.id, target.id]
  );
  json(res, 201, { blocker: member.username, blocked: target.username });
}

async function apiUnblock(req, res, username) {
  const member = await requireMember(req);
  const target = await memberByUsername(username);
  if (!target) err(404, 'That member is not here.');
  await query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [member.id, target.id]);
  json(res, 200, {});
}

// ---------------------------------------------------------------- admin void

async function apiVoidGame(req, res, gameId) {
  const member = await requireMember(req);
  if (member.role !== 'administrator') err(403, 'Only an administrator can void a game.');
  const audits = await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [gameId]);
    const game = lock.rows[0];
    if (!game) err(404, 'That game is not here.');
    if (game.status !== 'finished') err(409, 'Only a finished game can be voided.');
    if (!game.rated) err(409, 'Only a rated game can be voided.');
    if (game.black_id === null || game.white_id === game.black_id) err(409, 'Only a game between two members can be voided.');
    const white = await memberById(game.white_id);
    const black = await memberById(game.black_id);
    const before = { [game.white_id]: white.rating, [game.black_id]: black.rating };
    // void: keep status/result, become unrated, reason 'void'
    await client.query(
      `UPDATE games SET rated=FALSE, end_reason='void', last_move_at=last_move_at WHERE id=$1`,
      [gameId]
    );
    // recompute every later rated game of both players in order, from their
    // baselines, with this game removed from the walk
    const state = await replayRatings(client, [game.white_id, game.black_id], { excludeGameId: gameId });
    const rows = [];
    for (const memberId of [game.white_id, game.black_id]) {
      const s = state.get(memberId);
      const after = clampRating(s.rating);
      await client.query('UPDATE members SET rating=$2, rated_games=$3 WHERE id=$1', [memberId, after, s.games]);
      const a = await client.query(
        `INSERT INTO rating_audit (game_id, admin_id, member_id, rating_before, rating_after, created_at)
         VALUES ($1,$2,$3,$4,$5,now()) RETURNING *`,
        [gameId, member.id, memberId, before[memberId], after]
      );
      rows.push({
        id: a.rows[0].id, game_id: gameId, administrator: member.username,
        member: s.username, rating_before: before[memberId], rating_after: after,
      });
    }
    return rows;
  });
  json(res, 200, audits);
}

export {
  apiDeclineChallenge,
  apiDrawOffer, apiDrawResponse, apiClaim, apiTakeback, apiTakebackResponse,
  apiResign, apiRematch, apiGetRecord, apiImportRecord, apiGetChat, apiPostChat,
  apiListChallenges, apiCreateChallenge, apiAcceptChallenge, apiListClubs, apiGetClub,
  apiListMembers, apiGetMember, apiMemberGames, apiLeaderboard, apiNotifications,
  apiMarkRead, apiBlock, apiUnblock, apiVoidGame,
};
