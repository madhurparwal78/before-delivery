// Shared API plumbing: errors, JSON, auth, the game payload shape.
import { query, withTransaction } from '../lib/db.mjs';
import { parseFen, START_FEN } from '../lib/chess.mjs';
import { announcementFor } from '../lib/san.mjs';
import { hashToken } from '../lib/auth.mjs';
import { claimsFor, shapeMember, shapeGame, loadGame, houseSide } from '../lib/games.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const err = (status, message) => { throw new HttpError(status, message); };

export function json(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export function readBody(req, limit = 2 * 1024 * 1024 + 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'That upload is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function requireJson(req) {
  const buf = await readBody(req, 1024 * 1024);
  const text = buf.toString('utf8');
  if (!text.trim()) err(400, 'A request body is required.');
  const parsed = safeJsonParse(text);
  if (parsed === null || typeof parsed !== 'object') err(400, 'The request body must be JSON.');
  return parsed;
}

export async function authMember(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  let token = match ? match[1].trim() : null;
  if (!token) {
    const cookie = (req.headers.cookie || '').match(/gh_token=([^;]+)/);
    if (cookie) token = decodeURIComponent(cookie[1]);
  }
  if (!token) return null;
  const r = await query(
    `SELECT m.* FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = $1`,
    [hashToken(token)]
  );
  return r.rows[0] || null;
}

export async function requireMember(req) {
  const m = await authMember(req);
  if (!m) err(401, 'Sign in to do that.');
  return m;
}

export function plyBeforeFen(m, moves, game) {
  const idx = moves.findIndex(x => x.ply === m.ply);
  if (idx <= 0) return game.fen_start || START_FEN;
  return moves[idx - 1].fen_after;
}

export const houseMemberId = () => 'mem_the_house';

export async function gamePayload(game) {
  const loaded = await loadGame(game.id);
  const { moves, white, black } = loaded;
  const moveFens = moves.map(m => m.fen_after);
  const club = game.club_id ? (await query('SELECT slug FROM clubs WHERE id=$1', [game.club_id])).rows[0] : null;
  const shapeSide = (m) => {
    if (!m || m.id === houseMemberId()) return houseSide();
    return shapeMember(m);
  };
  return shapeGame(game, {
    white: shapeSide(white),
    black: shapeSide(black),
    moves: moves.map(m => ({
      ply: m.ply, uci: m.uci, san: m.san, fen_after: m.fen_after,
      announcement: announcementFor(plyBeforeFen(m, moves, game), m.uci),
      created_at: m.created_at,
    })),
    claims: claimsFor(game, moveFens),
    club_slug: club ? club.slug : null,
  });
}
