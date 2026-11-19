// Game record (PGN-like text): export with the seven tags in order, import by replay.
import { parseFen, legalMoves, applyMove, toFen, statusOf, START_FEN, sqToName, nameToSq } from './chess.mjs';
import { openingFor } from './san.mjs';

const uciOf = m => sqToName(m.from) + sqToName(m.to) + (m.promo || '');

// San -> uci for the position. Handles captures 'x', disambiguation, check/mate marks,
// castling and promotions (=Q).
export function sanToUci(fen, san) {
  const pos = parseFen(fen);
  const clean = san.replace(/[+#!?]/g, '').trim();
  const moves = legalMoves(pos);
  if (clean === 'O-O' || clean === '0-0') {
    const mv = moves.find(m => m.castle === 'k');
    return mv ? uciOf(mv) : null;
  }
  if (clean === 'O-O-O' || clean === '0-0-0') {
    const mv = moves.find(m => m.castle === 'q');
    return mv ? uciOf(mv) : null;
  }
  const promoMatch = clean.match(/^([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8])=([QRBN])$/);
  let promo = null;
  let body = clean;
  if (promoMatch) { body = promoMatch[1]; promo = promoMatch[2].toLowerCase(); }
  if (!/^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8]$/.test(body)) return null;
  const pieceLetter = /^[KQRBN]/.test(body) ? body[0] : 'P';
  const pieceType = { K: 'k', Q: 'q', R: 'r', B: 'b', N: 'n', P: 'p' }[pieceLetter];
  const destMatch = body.match(/([a-h][1-8])$/);
  const dest = destMatch[1];
  const destSq = nameToSq(dest);
  const isCapture = body.includes('x');
  let fromFile = null, fromRank = null;
  const rest = body.slice(pieceLetter === 'P' ? 0 : 1, body.length - 2);
  const disambig = rest.replace('x', '');
  if (disambig.length >= 1 && /[a-h]/.test(disambig[0])) fromFile = disambig[0];
  if (disambig.length >= 2 && /[1-8]/.test(disambig[disambig.length - 1])) fromRank = disambig[disambig.length - 1];
  const candidates = moves.filter(m => {
    const piece = pos.board[m.from];
    if (!piece || piece.t !== pieceType) return false;
    if (m.to !== destSq) return false;
    if (pieceType === 'p') {
      if (isCapture !== !!m.capture && !(m.ep && isCapture)) return false;
      if (fromFile && sqToName(m.from)[0] !== fromFile) return false;
    }
    if (fromFile && pieceType !== 'p' && sqToName(m.from)[0] !== fromFile) return false;
    if (fromRank && sqToName(m.from)[1] !== fromRank) return false;
    if (promo && m.promo !== promo) return false;
    if (!promo && m.promo && pieceType === 'p') return false;
    return true;
  });
  if (candidates.length !== 1) return null;
  return uciOf(candidates[0]);
}

// Exports the record: the seven tags in the standard order, then the move text.
export function buildRecord(game, moves, whiteUsername, blackUsername) {
  const started = new Date(game.created_at);
  const date = `${started.getUTCFullYear()}.${String(started.getUTCMonth() + 1).padStart(2, '0')}.${String(started.getUTCDate()).padStart(2, '0')}`;
  const tags = [
    ['Event', 'Gambit Hall game'],
    ['Site', 'Gambit Hall'],
    ['Date', date],
    ['Round', '-'],
    ['White', whiteUsername],
    ['Black', blackUsername],
    ['Result', game.status === 'in_progress' ? '*' : game.result],
  ];
  const head = tags.map(([k, v]) => `[${k} "${v}"]`).join('\n');
  // move text: numbered pairs of SAN
  const sans = moves.map(m => m.san);
  let body = '';
  let moveNo = parseFen(game.fen_start || START_FEN).fullmove;
  let firstOfPair = parseFen(game.fen_start || START_FEN).turn === 'w';
  for (let i = 0; i < sans.length; i++) {
    if (firstOfPair) body += `${moveNo}. `;
    body += sans[i] + ' ';
    if (!firstOfPair) moveNo += 1;
    firstOfPair = !firstOfPair;
  }
  body += (game.status === 'in_progress' ? '*' : game.result);
  return `${head}\n\n${body.trim()}\n`;
}

// Imports a record: replays the SAN from the standard start, refusing a bad record
// and naming the line that failed.
export function parseRecord(record) {
  const text = String(record || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const errors = [];
  const tagRe = /^\s*\[(\w+)\s+"([^"]*)"\]\s*$/;
  const tags = [];
  let moveTextStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { if (moveTextStart === -1 && tags.length) moveTextStart = i + 1; continue; }
    const m = line.match(tagRe);
    if (m) { tags.push([m[1], m[2], i + 1]); continue; }
    moveTextStart = i;
    break;
  }
  if (tags.length === 0) errors.push({ line: 1, message: 'The record carries no tags.' });
  const standardOrder = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
  for (let i = 0; i < standardOrder.length; i++) {
    if (!tags[i] || tags[i][0] !== standardOrder[i]) {
      errors.push({ line: tags[i] ? tags[i][2] : 1, message: `The ${standardOrder[i]} tag is missing or out of order.` });
      break;
    }
  }
  const dateTag = tags.find(t => t[0] === 'Date');
  if (dateTag && !/^\d{4}\.\d{2}\.\d{2}$/.test(dateTag[1])) {
    errors.push({ line: dateTag[2], message: 'The Date tag must read YYYY.MM.DD.' });
  }
  if (errors.length) return { ok: false, errors };

  const moveLines = lines.slice(moveTextStart).join(' ');
  const tokens = moveLines.replace(/\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean);
  const sans = [];
  for (const tok of tokens) {
    if (/^\d+\.$/.test(tok) || /^\d+\.$/.test(tok)) continue;
    if (/^\d+\.$/.test(tok)) continue;
    if (/^\d+\./.test(tok)) {
      const rest = tok.replace(/^\d+\./, '');
      if (rest) sans.push(rest);
      continue;
    }
    if (tok === '*' || tok === '1-0' || tok === '0-1' || tok === '1/2-1/2') {
      // result marker: must be last
      const idx = tokens.indexOf(tok);
      if (idx !== tokens.length - 1) {
        errors.push({ line: moveTextStart + 1, message: `The result ${tok} appears before the last move.` });
      }
      continue;
    }
    if (/^\(\d/.test(tok)) continue;   // variation markers are refused
    sans.push(tok);
  }
  if (sans.length === 0) errors.push({ line: moveTextStart + 1 || 1, message: 'The record carries no moves.' });

  // replay
  let fen = START_FEN;
  const played = [];
  for (const san of sans) {
    const uci = sanToUci(fen, san);
    if (!uci) {
      errors.push({ line: moveTextStart + 1, message: `The move ${san} is not legal in that position.` });
      break;
    }
    const pos = parseFen(fen);
    const mv = legalMoves(pos).find(m => uciOf(m) === uci);
    fen = toFen(applyMove(pos, mv));
    played.push(uci);
  }
  if (errors.length) return { ok: false, errors };
  const finalPos = parseFen(fen);
  return {
    ok: true,
    uciMoves: played,
    finalFen: fen,
    status: statusOf(finalPos),
    tags: Object.fromEntries(tags.map(t => [t[0], t[1]])),
    opening: openingFor(played),
  };
}
