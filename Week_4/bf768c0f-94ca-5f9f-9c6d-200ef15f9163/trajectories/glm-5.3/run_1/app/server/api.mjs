// Gambit Hall API: auth, profile, games, moves.
import crypto from 'node:crypto';
import { query, withTransaction } from '../lib/db.mjs';
import { hashPassword, verifyPassword, newToken, hashToken, newId, lockConfig } from '../lib/auth.mjs';
import { parseFen, legalMoves, applyMove, toFen, statusOf, insufficientMaterial, START_FEN, repetitionCount } from '../lib/chess.mjs';
import { sanFor, announcementFor, openingFor } from '../lib/san.mjs';
import { houseMove } from '../lib/house.mjs';
import {
  memberById, memberByUsername, canSeeGame, playerColour, positionHistory,
  notify, shapeMember, loadGame, settleGame, applyRatingChange, moveFromUci, uciOfMove,
} from '../lib/games.mjs';
import { buildRecord, parseRecord } from '../lib/record.mjs';
import { renderPage } from '../ssr/pages.mjs';
import { HttpError, err, json, readBody, requireJson, authMember, requireMember, gamePayload, houseMemberId } from './api-helpers.mjs';

const PORT = process.env.APP_PUBLIC_PORT || '4173';
const PUBLIC_URL = process.env.APP_PUBLIC_URL || `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- sessions

async function memberForToken(token) {
  if (!token) return null;
  const r = await query(
    `SELECT m.* FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = $1`, [hashToken(token)]
  );
  return r.rows[0] || null;
}

// ---------------------------------------------------------------- logging

function logRequest(requestId, req, status, startedAt) {
  const line = {
    ts: new Date().toISOString(),
    request_id: requestId,
    method: req.method,
    path: req.url,
    status,
    ms: Math.round(performance.now() - startedAt),
  };
  process.stdout.write(JSON.stringify(line) + '\n');
}

// ---------------------------------------------------------------- pages

const PUBLIC_PAGES = new Set(['/', '/login', '/join']);
const MEMBER_PAGES = new Set([
  '/hall', '/play', '/challenges', '/clubs', '/members', '/leaderboard',
  '/notifications', '/settings', '/admin/games',
]);

const KNOWN_DYNAMIC = [/^\/game\/([^/]+)(\/record)?$/, /^\/clubs\/([^/]+)$/, /^\/members\/([^/]+)$/];

async function handlePage(req, res, pathname) {
  const member = await authMember(req);
  const isKnown = PUBLIC_PAGES.has(pathname) || MEMBER_PAGES.has(pathname) ||
    KNOWN_DYNAMIC.some(rx => rx.test(pathname));
  if (!isKnown) return false;   // unknown address -> not-found page from the router
  if (!PUBLIC_PAGES.has(pathname) && !member) {
    res.writeHead(302, { Location: `/login?next=${encodeURIComponent(pathname)}` });
    res.end();
    return true;
  }
  // game pages, club pages and member pages are dynamic
  const gameMatch = pathname.match(/^\/game\/([^/]+)(\/record)?$/);
  if (gameMatch) return renderGamePage(req, res, pathname, gameMatch, member);
  const clubMatch = pathname.match(/^\/clubs\/([^/]+)$/);
  if (clubMatch) return renderClubPage(req, res, pathname, clubMatch, member);
  const memberMatch = pathname.match(/^\/members\/([^/]+)$/);
  if (memberMatch) return renderMemberPage(req, res, pathname, memberMatch, member);
  if (MEMBER_PAGES.has(pathname) || PUBLIC_PAGES.has(pathname)) {
    const html = await renderPage(pathname, { member, req });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }
  return false;   // unknown address -> not-found page
}

async function renderGamePage(req, res, pathname, match, member) {
  const [, gameId, suffix] = match;
  if (!member) err(302, '/login');
  const loaded = await loadGame(gameId);
  const visible = loaded && await canSeeGame(member, loaded.game);
  if (!visible) {
    const html = await renderPage('/not-found', { member, req });
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }
  const settled = await withTransaction(async client => settleGame(client, loaded.game));
  const reloaded = await loadGame(gameId);
  const html = await renderPage(suffix ? `/game/record` : `/game/view`, {
    member, req, game: reloaded.game, moves: reloaded.moves, white: reloaded.white, black: reloaded.black,
  });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
  return true;
}

async function renderClubPage(req, res, pathname, match, member) {
  const slug = decodeURIComponent(match[1]);
  const club = (await query('SELECT * FROM clubs WHERE slug = $1', [slug])).rows[0];
  const isMember = member && club && (await query(
    'SELECT 1 FROM club_memberships WHERE club_id=$1 AND member_id=$2 AND banned=FALSE', [club.id, member.id])).rowCount > 0;
  if (!club || (club.private && !isMember)) {
    const html = await renderPage('/not-found', { member, req });
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }
  const html = await renderPage('/clubs/slug', { member, req, club });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
  return true;
}

async function renderMemberPage(req, res, pathname, match, member) {
  const username = decodeURIComponent(match[1]);
  const target = await memberByUsername(username);
  if (!target) {
    const html = await renderPage('/not-found', { member, req });
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }
  const html = await renderPage('/members/username', { member, req, target });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
  return true;
}

// ---------------------------------------------------------------- game shape

// ---------------------------------------------------------------- API: auth

async function apiRegister(req, res) {
  const body = await requireJson(req);
  const { username, email, password } = body;
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    err(422, 'A username is 3 to 20 letters, digits and underscores.');
  }
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    err(422, 'That email address does not look right.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    err(422, 'A password is at least 8 characters.');
  }
  const takenUsername = await query('SELECT id FROM members WHERE lower(username)=lower($1)', [username]);
  if (takenUsername.rowCount > 0) err(409, 'That username is already taken.');
  const takenEmail = await query('SELECT id FROM members WHERE lower(email)=lower($1)', [email]);
  if (takenEmail.rowCount > 0) err(409, 'That email is already taken.');
  const id = newId('mem');
  await query(
    `INSERT INTO members (id, username, email, password_hash, rating, rated_games, avatar_key, role, view, piece_set_2d, piece_set_3d, theme, sound)
     VALUES ($1,$2,$3,$4,1500,0,'avatar_01','member','flat','Classic','Marble','Forest',TRUE)`,
    [id, username, email, hashPassword(password)]
  );
  const member = await memberById(id);
  json(res, 201, shapeMember(member));
}

async function apiLogin(req, res) {
  const body = await requireJson(req);
  const identifier = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!identifier || !password) err(422, 'Enter your username and password.');
  const member = await query(
    'SELECT * FROM members WHERE lower(username)=lower($1) OR lower(email)=lower($1)', [identifier]
  ).then(r => r.rows[0]);
  const { maxFails, lockoutSec } = lockConfig();
  if (member) {
    const fails = await query(
      `SELECT count(*) AS n FROM login_attempts
       WHERE username = $1 AND succeeded = FALSE AND attempted_at > now() - ($2 || ' seconds')::interval`,
      [member.username, String(lockoutSec)]
    );
    if (Number(fails.rows[0].n) >= maxFails) {
      await query('INSERT INTO login_attempts (username, succeeded, attempted_at) VALUES ($1,FALSE,now())', [member.username]);
      err(423, 'Too many refused sign-ins. Wait a while and try again.');
    }
  }
  let ok = false;
  if (member) ok = verifyPassword(password, member.password_hash);
  if (member) await query('INSERT INTO login_attempts (username, succeeded, attempted_at) VALUES ($1,$2,now())', [member.username, ok]);
  if (!ok) err(401, 'That username and password do not match.');
  const token = newToken();
  const id = newId('ses');
  await query('INSERT INTO sessions (id, member_id, token_hash, created_at) VALUES ($1,$2,$3,now())', [id, member.id, hashToken(token)]);
  json(res, 200, { token, member: shapeMember(member) }, {
    'Set-Cookie': `gh_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
  });
}

async function apiLogout(req, res) {
  const member = await authMember(req);
  if (member) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    let token = match ? match[1].trim() : null;
    if (!token) {
      const cookie = (req.headers.cookie || '').match(/gh_token=([^;]+)/);
      token = cookie ? decodeURIComponent(cookie[1]) : null;
    }
    if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }
  json(res, 200, {}, { 'Set-Cookie': 'gh_token=; Path=/; HttpOnly; Max-Age=0' });
}

// ---------------------------------------------------------------- API: profile

const VIEW_VALUES = ['flat', 'deep', 'squares'];
const SET2D_VALUES = ['Classic', 'Staunton Flat', 'Neo', 'Pixel'];
const SET3D_VALUES = ['Marble', 'Wood', 'Glass'];
const THEME_VALUES = ['Walnut', 'Slate', 'Ocean', 'Forest', 'Neon'];

function validatePrefs(body) {
  const patch = {};
  if ('username' in body) {
    if (typeof body.username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(body.username)) {
      err(422, 'A username is 3 to 20 letters, digits and underscores.');
    }
    patch.username = body.username;
  }
  if ('view' in body) {
    if (!VIEW_VALUES.includes(body.view)) err(422, 'That view is not one of the three views.');
    patch.view = body.view;
  }
  if ('piece_set_2d' in body) {
    if (!SET2D_VALUES.includes(body.piece_set_2d)) err(422, 'That flat piece set is not offered.');
    patch.piece_set_2d = body.piece_set_2d;
  }
  if ('piece_set_3d' in body) {
    if (!SET3D_VALUES.includes(body.piece_set_3d)) err(422, 'That deep piece set is not offered.');
    patch.piece_set_3d = body.piece_set_3d;
  }
  if ('theme' in body) {
    if (!THEME_VALUES.includes(body.theme)) err(422, 'That board theme is not offered.');
    patch.theme = body.theme;
  }
  if ('sound' in body) {
    if (typeof body.sound !== 'boolean') err(422, 'Sound is either on or off.');
    patch.sound = body.sound;
  }
  return patch;
}

async function apiGetProfile(req, res) {
  const member = await requireMember(req);
  json(res, 200, shapeMember(member));
}

async function apiPatchProfile(req, res) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  const patch = validatePrefs(body);
  if ('username' in patch && patch.username.toLowerCase() !== member.username.toLowerCase()) {
    const taken = await query('SELECT id FROM members WHERE lower(username)=lower($1) AND id <> $2', [patch.username, member.id]);
    if (taken.rowCount > 0) err(409, 'That username is already taken.');
  }
  const keys = Object.keys(patch);
  if (!keys.length) return json(res, 200, shapeMember(member));
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const r = await query(`UPDATE members SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`, [...keys.map(k => patch[k]), member.id]);
  json(res, 200, shapeMember(r.rows[0]));
}

// ---------------------------------------------------------------- API: avatar

const AVATAR_KEYS = ['avatar_01','avatar_02','avatar_03','avatar_04','avatar_05','avatar_06',
  'avatar_07','avatar_08','avatar_09','avatar_10','avatar_11','avatar_12'];

async function apiAvatar(req, res, memberParam) {
  const member = await requireMember(req);
  if (memberParam && memberParam.toLowerCase() !== member.username.toLowerCase()) {
    err(403, 'That is not your picture to change.');
  }
  const contentType = req.headers['content-type'] || '';
  let key = null;
  if (contentType.includes('multipart/form-data')) {
    const buf = await readBody(req, 2 * 1024 * 1024 + 64 * 1024);
    const file = extractMultipartFile(buf, contentType);
    if (!file) err(422, 'Choose a picture to upload.');
    if (file.data.length > 2 * 1024 * 1024) err(413, 'A picture may be at most 2 MB.');
    const sniffed = sniffImage(file.data, file.filename);
    if (!sniffed) err(415, 'A picture is a PNG, JPEG or WebP.');
    const png = await resizeToPng(file.data);
    await query('DELETE FROM avatars WHERE member_id = $1', [member.id]);
    await query('INSERT INTO avatars (member_id, data, created_at) VALUES ($1,$2,now())', [member.id, png]);
    key = `uploaded:${member.id}`;
  } else {
    const body = await requireJson(req);
    if (typeof body.avatar !== 'string' || !AVATAR_KEYS.includes(body.avatar)) {
      err(422, 'A picture is one of the twelve supplied avatars.');
    }
    key = body.avatar;
  }
  const r = await query('UPDATE members SET avatar_key = $2 WHERE id = $1 RETURNING *', [member.id, key]);
  json(res, 200, shapeMember(r.rows[0]));
}

function sniffImage(data, filename) {
  const magicPng = data.length > 8 && data[0] === 0x89 && data[1] === 0x50;
  const magicJpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const magicWebp = data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  const byName = /\.(png|jpe?g|webp)$/i.test(filename || '');
  const magicOk = magicPng || magicJpeg || magicWebp;
  if (!magicOk || !byName) return null;
  if (magicPng) return 'png';
  if (magicJpeg) return 'jpeg';
  return 'webp';
}

async function resizeToPng(data) {
  const sharp = (await import('sharp')).default;
  return sharp(data).resize(256, 256, { fit: 'cover' }).png().toBuffer();
}

function extractMultipartFile(buf, contentType) {
  const m = contentType.match(/boundary=([^;]+)/i);
  if (!m) return null;
  const boundary = Buffer.from('--' + m[1].trim());
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const headEnd = buf.indexOf('\r\n\r\n', start);
    const next = buf.indexOf(boundary, headEnd);
    if (headEnd === -1 || next === -1) break;
    const head = buf.toString('utf8', start, headEnd);
    if (/name="file"/i.test(head)) {
      const data = buf.slice(headEnd + 4, next - 2);  // strip trailing CRLF
      const nameMatch = head.match(/filename="([^"]*)"/i);
      return { data, filename: nameMatch ? nameMatch[1] : 'upload' };
    }
    start = next;
  }
  return null;
}

// ---------------------------------------------------------------- API: games

async function getGameOr404(member, gameId) {
  const loaded = await loadGame(gameId);
  const visible = loaded && await canSeeGame(member, loaded.game);
  if (!visible) err(404, 'That game is not here.');
  const settled = await withTransaction(async client => settleGame(client, loaded.game));
  return { game: settled, loaded };
}

async function apiGetGame(req, res, gameId) {
  const member = await requireMember(req);
  const { game } = await getGameOr404(member, gameId);
  json(res, 200, await gamePayload(game));
}

async function apiLegalMoves(req, res, gameId) {
  const member = await requireMember(req);
  const { game } = await getGameOr404(member, gameId);
  const pos = parseFen(game.fen);
  json(res, 200, legalMoves(pos).map(uciOfMove));
}

// Plays one move inside a locked transaction. Returns the stored move row.
async function playMove(client, game, uci, moverColour, { notifyIds = [], moverUsername = null } = {}) {
  const pos = parseFen(game.fen);
  if (pos.turn !== (moverColour === 'white' ? 'w' : 'b')) err(409, 'It is not your turn.');
  const move = moveFromUci(pos, uci);
  if (!move) err(422, 'That move is not legal here.');
  const after = applyMove(pos, move);
  const fenAfter = toFen(after);
  const ply = (await client.query('SELECT coalesce(max(ply),0)+1 AS p FROM moves WHERE game_id=$1', [game.id])).rows[0].p;
  const san = sanFor(game.fen, uci);
  const inserted = await client.query(
    `INSERT INTO moves (game_id, ply, uci, san, fen_after, created_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (game_id, ply) DO NOTHING
     RETURNING *`,
    [game.id, ply, uci, san, fenAfter]
  );
  if (inserted.rowCount === 0) err(409, 'The position has moved on.');
  const st = statusOf(after);
  let status = game.status, result = game.result, endReason = game.end_reason;
  if (st.over) {
    status = 'finished'; result = st.result; endReason = st.reason;
  } else if (insufficientMaterial(after)) {
    status = 'finished'; result = '1/2-1/2'; endReason = 'insufficient material';
  } else {
    const moveFens = (await client.query('SELECT fen_after FROM moves WHERE game_id=$1 ORDER BY ply', [game.id])).rows.map(r => r.fen_after);
    if (repetitionCount(positionHistory(game, moveFens)) >= 5) {
      status = 'finished'; result = '1/2-1/2'; endReason = 'fivefold repetition';
    }
  }
  const allUci = (await client.query('SELECT uci FROM moves WHERE game_id=$1 ORDER BY ply', [game.id])).rows.map(r => r.uci);
  // a draw offer survives the offerer's own move and expires when the opponent moves
  const offerKept = moverUsername && game.draw_offer_by === moverUsername ? game.draw_offer_by : null;
  await client.query(
    `UPDATE games SET fen=$2, status=$3, result=$4, end_reason=$5,
       draw_offer_by=$7, takeback_by=NULL, last_move_at=now(), opening=$6
     WHERE id = $1`,
    [game.id, fenAfter, status, result, endReason, openingFor(allUci), offerKept]
  );
  for (const id of notifyIds) {
    await notify(client, id, 'move', game.id);
  }
  if (status === 'finished') {
    const fresh = (await client.query('SELECT * FROM games WHERE id=$1', [game.id])).rows[0];
    if (fresh.rated && fresh.black_id !== null && fresh.white_id !== fresh.black_id) {
      await applyRatingChange(client, game.id);
    }
  }
  return inserted.rows[0];
}

// The colour a solo study game's creator plays: the side to move in its start FEN.
function studyCreatorColour(game) {
  return parseFen(game.fen_start || START_FEN).turn === 'w' ? 'white' : 'black';
}

async function apiPlayMove(req, res, gameId) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  if (typeof body.move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(body.move)) {
    err(422, 'A move is written in coordinate form, like e2e4.');
  }
  const loaded = await loadGame(gameId);
  if (!loaded || !(await canSeeGame(member, loaded.game))) err(404, 'That game is not here.');
  const g = loaded.game;
  const solo = g.white_id === g.black_id;
  const houseGame = !solo && (g.white_id === houseMemberId() || g.black_id === houseMemberId());

  const finalGame = await withTransaction(async client => {
    const lock = await client.query('SELECT * FROM games WHERE id = $1 FOR UPDATE', [gameId]);
    const game = lock.rows[0];
    if (!game) err(404, 'That game is not here.');
    const settled = await settleGame(client, game);
    if (settled.status !== 'in_progress') err(409, 'This game is over.');
    const pos = parseFen(settled.fen);

    // resolve the mover's colour and the opponent to notify
    let mover, opponentIds = [];
    if (solo) {
      if (game.white_id !== member.id) err(403, 'This game is not yours.');
      if (game.level) {
        const creatorColour = studyCreatorColour(game);
        const sideToMove = pos.turn === 'w' ? 'white' : 'black';
        if (sideToMove !== creatorColour) err(409, 'The house is thinking; it is not your turn.');
        mover = creatorColour;
      } else {
        mover = pos.turn === 'w' ? 'white' : 'black';
      }
    } else if (houseGame) {
      if (game.white_id !== member.id && game.black_id !== member.id) err(403, 'You are not a player in this game.');
      mover = game.white_id === member.id ? 'white' : 'black';
    } else {
      const colour = playerColour(member, game);
      if (!colour) err(403, 'You are not a player in this game.');
      mover = colour;
      opponentIds = [game.white_id === member.id ? game.black_id : game.white_id];
    }
    await playMove(client, game, body.move, mover, { notifyIds: opponentIds, moverUsername: member.username });

    // the house replies inside the same request
    let fresh = (await client.query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0];
    const houseTurn = fresh.status === 'in_progress' && (houseGame || (solo && game.level));
    if (houseTurn) {
      let houseColour = null;
      if (houseGame) houseColour = fresh.white_id === houseMemberId() ? 'white' : 'black';
      else if (solo && game.level) houseColour = studyCreatorColour(game) === 'white' ? 'black' : 'white';
      const turnColour = parseFen(fresh.fen).turn === 'w' ? 'white' : 'black';
      if (houseColour === turnColour) {
        const reply = houseMove(fresh.fen, game.level || 'steady');
        if (reply) await playMove(client, fresh, reply, houseColour, { notifyIds: [], moverUsername: 'The house' });
      }
    }
    return (await client.query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0];
  });
  json(res, 201, await gamePayload(finalGame));
}

// ---------------------------------------------------------------- house & study games

async function apiComputerGame(req, res) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  const level = body.level;
  if (!['easy', 'steady', 'sharp'].includes(level)) err(422, 'The house plays at easy, steady or sharp.');
  const colour = body.colour === 'black' ? 'black' : 'white';
  const gameId = newId('game');
  const house = houseMemberId();
  const whiteId = colour === 'white' ? member.id : house;
  const blackId = colour === 'white' ? house : member.id;
  await query(
    `INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, fen_start, status, result, created_at, last_move_at)
     VALUES ($1,$2,$3,NULL,FALSE,$4,$5,$5,'in_progress','*',now(),now())`,
    [gameId, whiteId, blackId, level, START_FEN]
  );
  let game = (await query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0];
  if (colour === 'black') {
    // the house's first move is already played
    const reply = houseMove(game.fen, level);
    await withTransaction(async client => {
      const lock = await client.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [gameId]);
      await playMove(client, lock.rows[0], reply, 'white', { notifyIds: [] });
    });
    game = (await query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0];
  }
  json(res, 201, await gamePayload(game));
}

async function apiFromFen(req, res) {
  const member = await requireMember(req);
  const body = await requireJson(req);
  if (typeof body.fen !== 'string') err(422, 'A position record is required.');
  let pos;
  try { pos = parseFen(body.fen); } catch { err(422, 'That position record is not valid.'); }
  const st = statusOf(pos);
  if (st.over) err(422, 'That position record is already finished.');
  const level = body.level !== undefined ? body.level : null;
  if (level !== null && !['easy', 'steady', 'sharp'].includes(level)) err(422, 'The house plays at easy, steady or sharp.');
  const gameId = newId('study');
  await query(
    `INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, fen_start, status, result, created_at, last_move_at)
     VALUES ($1,$2,$2,NULL,FALSE,$3,$4,$4,'in_progress','*',now(),now())`,
    [gameId, member.id, level, toFen(pos)]
  );
  const game = (await query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0];
  json(res, 201, await gamePayload(game));
}

export {
  apiRegister, apiLogin, apiLogout, apiGetProfile, apiPatchProfile, apiAvatar,
  apiGetGame, apiLegalMoves, apiPlayMove, apiComputerGame, apiFromFen,
  handlePage, getGameOr404,
};
