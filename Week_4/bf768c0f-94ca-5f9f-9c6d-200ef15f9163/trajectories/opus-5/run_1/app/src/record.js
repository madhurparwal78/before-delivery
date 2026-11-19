/**
 * The game record.  The single authority in this application for the text
 * format: its seven tags, its notation, its import and the opening table.
 */

import {
  START_FEN, parseFen, playMove, generateMoves, toSan, moveToUci,
} from './chess.js';

export const EVENT_NAME = 'Gambit Hall Club';
export const SITE_NAME = 'Gambit Hall';

/** The seven standard tags, in the standard order. */
export const TAG_ORDER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

/** The application's own pinned table of openings, in the coordinate form. */
export const OPENINGS = [
  { name: 'Italian Game', moves: 'e2e4 e7e5 g1f3 b8c6 f1c4' },
  { name: 'Ruy Lopez', moves: 'e2e4 e7e5 g1f3 b8c6 f1b5' },
  { name: 'Scotch Game', moves: 'e2e4 e7e5 g1f3 b8c6 d2d4' },
  { name: 'Sicilian Defence', moves: 'e2e4 c7c5' },
  { name: 'French Defence', moves: 'e2e4 e7e6' },
  { name: 'Caro-Kann Defence', moves: 'e2e4 c7c6' },
  { name: 'Queens Gambit', moves: 'd2d4 d7d5 c2c4' },
  { name: 'Slav Defence', moves: 'd2d4 d7d5 c2c4 c7c6' },
  { name: 'London System', moves: 'd2d4 d7d5 g1f3 g8f6 c1f4' },
  { name: 'English Opening', moves: 'c2c4' },
].map((entry) => ({ name: entry.name, sequence: entry.moves.split(' ') }));

/** The opening name, matched by the longest leading sequence of moves present. */
export function openingFor(ucis) {
  let best = null;
  for (const opening of OPENINGS) {
    const seq = opening.sequence;
    if (seq.length > ucis.length) continue;
    let matches = true;
    for (let i = 0; i < seq.length; i++) {
      if (ucis[i] !== seq[i]) { matches = false; break; }
    }
    if (!matches) continue;
    if (!best || seq.length > best.sequence.length) best = opening;
  }
  return best ? best.name : null;
}

export function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

function escapeTagValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Export a game as its text record.
 * `game` carries {white_username, black_username, result, created_at, round}
 * and `moves` is the ply-ordered list of {san}.
 */
export function exportRecord(game, moves) {
  const tags = {
    Event: EVENT_NAME,
    Site: SITE_NAME,
    Date: formatDate(game.created_at || new Date()),
    Round: game.round ? String(game.round) : '1',
    White: game.white_username,
    Black: game.black_username,
    Result: game.result || '*',
  };
  const lines = TAG_ORDER.map((tag) => `[${tag} "${escapeTagValue(tags[tag])}"]`);
  lines.push('');

  const tokens = [];
  moves.forEach((move, index) => {
    if (index % 2 === 0) tokens.push(`${index / 2 + 1}.`);
    tokens.push(move.san);
  });
  tokens.push(tags.Result);

  // Wrap the move text so no line runs past eighty columns.
  let line = '';
  const body = [];
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > 80) {
      body.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  if (line) body.push(line);
  lines.push(...body);
  return `${lines.join('\n')}\n`;
}

export class InvalidRecord extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.line = line || null;
  }
}

function normaliseSan(token) {
  return token
    .replace(/[+#]/g, '')
    .replace(/[!?]+$/g, '')
    .replace(/0-0-0/g, 'O-O-O')
    .replace(/0-0/g, 'O-O')
    .replace(/^([a-h][1-8])([QRBN])$/, '$1=$2');
}

/** Resolve one algebraic token against a position, or throw. */
export function sanToMove(position, token) {
  const wanted = normaliseSan(token);
  for (const move of generateMoves(position)) {
    if (normaliseSan(toSan(position, move)) === wanted) return move;
  }
  return null;
}

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/**
 * Import a text record.  Returns the tags, the replayed moves and the final
 * position record.  Throws InvalidRecord naming the line that failed.
 */
export function importRecord(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new InvalidRecord('the record is empty');
  }
  const lines = text.split(/\r?\n/);
  const tags = {};
  const movetext = [];
  let inMoves = false;

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (line === '') return;
    if (line.startsWith('%')) return;
    if (line.startsWith('[')) {
      if (inMoves) throw new InvalidRecord('a tag appears after the move text', lineNumber);
      const match = /^\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]$/.exec(line);
      if (!match) throw new InvalidRecord('this tag is malformed', lineNumber);
      tags[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return;
    }
    inMoves = true;
    movetext.push({ line: lineNumber, text: line });
  });

  for (const tag of ['White', 'Black', 'Result']) {
    if (!tags[tag]) throw new InvalidRecord(`the record has no ${tag} tag`, 1);
  }
  if (!RESULT_TOKENS.has(tags.Result)) {
    throw new InvalidRecord(`the Result tag "${tags.Result}" is not a result`, 1);
  }

  let fen = START_FEN;
  const moves = [];
  let seenResult = false;

  for (const chunk of movetext) {
    const cleaned = chunk.text
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/;.*$/, ' ')
      .replace(/\$\d+/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (/^\d+\.(\.\.)?$/.test(token)) continue;
      if (/^\d+$/.test(token)) continue;
      if (token === '...' || token === '.') continue;
      if (RESULT_TOKENS.has(token)) { seenResult = true; continue; }
      if (seenResult) throw new InvalidRecord(`"${token}" follows the result`, chunk.line);
      let position;
      try {
        position = parseFen(fen);
      } catch (error) {
        throw new InvalidRecord(`the position cannot be read: ${error.message}`, chunk.line);
      }
      const move = sanToMove(position, token);
      if (!move) throw new InvalidRecord(`"${token}" is not a legal move here`, chunk.line);
      const played = playMove(fen, moveToUci(move));
      moves.push({ uci: played.uci, san: played.san, fen_after: played.fen, announcement: played.announcement });
      fen = played.fen;
    }
  }

  if (moves.length === 0) throw new InvalidRecord('the record carries no moves', movetext.length ? movetext[0].line : 1);

  return {
    tags,
    moves,
    fen,
    result: tags.Result,
    opening: openingFor(moves.map((m) => m.uci)),
  };
}
