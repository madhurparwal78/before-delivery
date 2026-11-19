// Game logic helpers shared by the API: game object shape, visibility, claims, notifications.
import { query } from './db.mjs';
import { parseFen, legalMoves, statusOf, insufficientMaterial, positionKey, repetitionCount, sqToName, nameToSq, applyMove, toFen, START_FEN } from './chess.mjs';
import { ratingDisplay, clampRating } from './rating.mjs';
import { firstMoveAbortSec, moveDeadlineSec } from './auth.mjs';

export function uciOfMove(m) { return sqToName(m.from) + sqToName(m.to) + (m.promo || ''); }
export function moveFromUci(pos, uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  const from = nameToSq(uci.slice(0, 2)), to = nameToSq(uci.slice(2, 4));
  const promo = uci.length === 5 ? uci[4] : null;
  return legalMoves(pos).find(m => m.from === from && m.to === to && (m.promo || null) === promo) || null;
}

export async function memberById(id) {
  const r = await query('SELECT * FROM members WHERE id = $1', [id]);
  return r.rows[0] || null;
}
export async function memberByUsername(username) {
  const r = await query('SELECT * FROM members WHERE lower(username) = lower($1)', [username]);
  return r.rows[0] || null;
}

export function isHouseGame(game) { return game.black_id === null || game.white_id === null; }

// A game in a private club is visible only to its members; to anybody else it is
// exactly a game that does not exist.
export async function canSeeGame(member, game) {
  if (!member) return false;
  if (game.white_id === game.black_id) {
    // a solo study game is owned by its creator and invisible to everybody else
    return game.white_id === member.id;
  }
  if (game.white_id === member.id || game.black_id === member.id) return true;
  if (game.club_id) {
    const club = (await query('SELECT * FROM clubs WHERE id = $1', [game.club_id])).rows[0];
    if (club && club.private) {
      const m = await query(
        'SELECT 1 FROM club_memberships WHERE club_id = $1 AND member_id = $2 AND banned = FALSE',
        [game.club_id, member.id]
      );
      if (m.rowCount === 0) return false;   // private club, not a member -> does not exist
      return true;
    }
  }
  return true;  // public game: spectatable
}

export async function isPlayer(member, game) {
  return !!member && (game.white_id === member.id || game.black_id === member.id);
}

export function playerColour(member, game) {
  if (game.white_id === member.id) return 'white';
  if (game.black_id === member.id) return 'black';
  return null;
}

// Claims are derived, never stored.
export function claimsFor(game, moveFens) {
  if (game.status !== 'in_progress') return { threefold: false, 'fifty-move': false };
  const pos = parseFen(game.fen);
  const threefold = repetitionCount(positionHistory(game, moveFens)) >= 3;
  const fifty = pos.halfmove >= 100;
  return { threefold, 'fifty-move': fifty };
}

// Repetition is computed from the stored moves: the start position plus every
// position after each stored ply.
export function repetitionCountFor(game, moveFens) {
  return repetitionCount(positionHistory(game, moveFens));
}

export function positionHistory(game, moveFens) {
  const start = game.fen_start || START_FEN;
  return [start, ...(moveFens || [])];
}

export async function notify(client, memberId, kind, gameId) {
  await client.query(
    'INSERT INTO notifications (member_id, kind, game_id, read, created_at) VALUES ($1,$2,$3,FALSE, now())',
    [memberId, kind, gameId]
  );
}

export function shapeMember(m, extra = {}) {
  return {
    id: m.id,
    username: m.username,
    rating: m.rating,
    rating_display: ratingDisplay(m.rating, m.rated_games),
    rated_games: m.rated_games,
    avatar_url: avatarUrl(m),
    role: m.role,
    view: m.view,
    piece_set_2d: m.piece_set_2d,
    piece_set_3d: m.piece_set_3d,
    theme: m.theme,
    sound: m.sound,
    ...extra,
  };
}

export function avatarUrl(m) {
  if (m.avatar_key && m.avatar_key.startsWith('uploaded:')) {
    return `/media/avatars/${m.id}.png`;
  }
  return `/media/avatars/${m.avatar_key || 'avatar_01'}.svg`;
}

export function shapeGame(game, opts = {}) {
  const white = opts.white || null;
  const black = opts.black || null;
  return {
    id: game.id,
    game_id: game.id,
    fen: game.fen,
    turn: parseFen(game.fen).turn === 'w' ? 'white' : 'black',
    status: game.status,
    result: game.status === 'aborted' ? '' : game.result,
    end_reason: game.status === 'in_progress' ? null : game.end_reason,
    rated: game.rated,
    opening: game.opening || null,
    white,
    black,
    moves: opts.moves || [],
    draw_offer_by: game.draw_offer_by || null,
    takeback_by: game.takeback_by || null,
    claims: opts.claims || { threefold: false, 'fifty-move': false },
    club: opts.club_slug || null,
    level: game.level || null,
    created_at: game.created_at,
    last_move_at: game.last_move_at,
  };
}

// Loads a game with its moves and player shapes.
export async function loadGame(gameId) {
  const g = await query('SELECT * FROM games WHERE id = $1', [gameId]);
  const game = g.rows[0];
  if (!game) return null;
  const mv = await query('SELECT * FROM moves WHERE game_id = $1 ORDER BY ply', [gameId]);
  const white = (await memberById(game.white_id));
  const black = game.black_id ? await memberById(game.black_id) : houseSide();
  return { game, moves: mv.rows, white, black };
}

export function houseSide() {
  return {
    id: 'house',
    username: 'The house',
    rating: null,
    rating_display: null,
    rated_games: null,
    avatar_url: '/media/avatars/house.svg',
    role: 'member',
  };
}

// Settles abort/deadline when a game is read. Both windows come from the environment.
export async function settleGame(client, game) {
  if (game.status !== 'in_progress') return game;
  const abortSec = firstMoveAbortSec();
  const deadlineSec = moveDeadlineSec();
  const now = Date.now();
  const created = new Date(game.created_at).getTime();
  const lastMove = new Date(game.last_move_at).getTime();
  // count() arrives from PostgreSQL as text; compare it as a number
  const moveCount = Number((await client.query('SELECT count(*) AS n FROM moves WHERE game_id = $1', [game.id])).rows[0].n);
  if (moveCount === 0 && (now - created) / 1000 > abortSec) {
    const r = await client.query(
      `UPDATE games SET status='aborted', result='', end_reason=NULL, rated=FALSE, last_move_at=now() WHERE id=$1 AND status='in_progress' RETURNING *`,
      [game.id]
    );
    return r.rows[0] || game;
  }
  if (moveCount > 0 && (now - lastMove) / 1000 > deadlineSec) {
    const pos = parseFen(game.fen);
    const result = pos.turn === 'w' ? '0-1' : '1-0';   // lost by the player who owed the move
    const r = await client.query(
      `UPDATE games SET status='finished', result=$2, end_reason='deadline', last_move_at=now() WHERE id=$1 AND status='in_progress' RETURNING *`,
      [game.id, result]
    );
    const updated = r.rows[0] || game;
    if (updated.rated && game.black_id !== null) {
      await applyRatingChange(client, game.id);
    }
    return updated;
  }
  return game;
}

// Applies the rating change for a finished rated member-vs-member game, using the
// ratings both players held before the game (derived by replay from stored games).
export async function applyRatingChange(client, gameId) {
  const { ratingDeltas } = await import('./rating.mjs');
  const g = await client.query('SELECT * FROM games WHERE id = $1', [gameId]);
  const game = g.rows[0];
  if (!game || !game.rated || game.black_id === null || game.status !== 'finished') return;
  const pre = await preGameRatings(client, game);
  if (!pre) return;
  const score = game.result === '1-0' ? 1 : game.result === '0-1' ? 0 : 0.5;
  const deltas = ratingDeltas(pre.white.rating, pre.white.games, pre.black.rating, pre.black.games, score);
  const newWhite = clampRating(pre.white.rating + deltas.white);
  const newBlack = clampRating(pre.black.rating + deltas.black);
  await client.query('UPDATE members SET rating=$2 WHERE id=$1', [game.white_id, newWhite]);
  await client.query('UPDATE members SET rating=$2 WHERE id=$1', [game.black_id, newBlack]);
  await client.query('UPDATE members SET rated_games = rated_games + 1 WHERE id = ANY($1)', [[game.white_id, game.black_id]]);
}

async function preGameRatings(client, game) {
  const state = await replayRatings(client, [game.white_id, game.black_id], { beforeGameId: game.id });
  const w = state.get(game.white_id), b = state.get(game.black_id);
  if (!w || !b) return null;
  return { white: w, black: b };
}

// Replays every finished rated game reachable from the given members, in finish
// order, from each member's baseline (the numbers they held before their first
// stored rated game). This is the single source of truth for pre-game ratings:
// because every rated result was applied through this same replay, the walk is
// globally consistent. excludeGameId removes one game (a void) and beforeGameId
// stops the walk at the start of a given game so its pre-game numbers are known.
export async function replayRatings(client, seedIds, { beforeGameId = null, excludeGameId = null } = {}) {
  const { baselineFor } = await import('./rating.mjs');
  const state = new Map();   // memberId -> { rating, games, username }
  const pending = [...seedIds];
  const seenIds = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const r = await client.query('SELECT username FROM members WHERE id = $1', [id]);
    const username = r.rows[0]?.username || '';
    const b = baselineFor(username);
    state.set(id, { rating: b.rating, games: b.games, username });
    const partners = await client.query(
      `SELECT white_id, black_id FROM games
       WHERE rated = TRUE AND status = 'finished' AND black_id IS NOT NULL
         AND (white_id = $1 OR black_id = $1)`, [id]);
    for (const row of partners.rows) {
      if (!seenIds.has(row.white_id)) pending.push(row.white_id);
      if (!seenIds.has(row.black_id)) pending.push(row.black_id);
    }
  }
  const all = await client.query(
    `SELECT * FROM games
     WHERE rated = TRUE AND status = 'finished' AND black_id IS NOT NULL
       AND (white_id = ANY($1) OR black_id = ANY($1))
     ORDER BY last_move_at ASC, id ASC`,
    [[...seenIds]]
  );
  const { ratingDeltas } = await import('./rating.mjs');
  for (const g of all.rows) {
    if (excludeGameId && g.id === excludeGameId) continue;
    if (beforeGameId && g.id === beforeGameId) return state;
    const w = state.get(g.white_id), b = state.get(g.black_id);
    if (!w || !b) continue;
    const score = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : 0.5;
    const d = ratingDeltas(w.rating, w.games, b.rating, b.games, score);
    w.rating = clampRating(w.rating + d.white); w.games += 1;
    b.rating = clampRating(b.rating + d.black); b.games += 1;
  }
  return state;
}
