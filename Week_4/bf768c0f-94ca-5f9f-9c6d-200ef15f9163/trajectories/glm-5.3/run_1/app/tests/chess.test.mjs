import { parseFen, toFen, legalMoves, applyMove, statusOf, insufficientMaterial, positionKey, repetitionCount, START_FEN, sqToName } from '/app/lib/chess.mjs';
import { sanFor, announcementFor, openingFor } from '/app/lib/san.mjs';
import { houseMove } from '/app/lib/house.mjs';
import { ratingDeltas, stepFactor, ratingDisplay, clampRating } from '/app/lib/rating.mjs';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; failures.push(name + (extra ? ` :: ${extra}` : '')); }
}
function uci(m) { return sqToName(m.from) + sqToName(m.to) + (m.promo || ''); }
const uciSet = fen => new Set(legalMoves(parseFen(fen)).map(uci));

// --- starting position: exactly 20 legal moves
check('start has 20 legal moves', uciSet(START_FEN).size === 20, `${uciSet(START_FEN).size}`);

// --- worked position: en passant availability
// From 4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1, White d2d4 sets ep field to d3.
{
  const fen = '4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1';
  const pos = parseFen(fen);
  const mv = legalMoves(pos).find(m => uci(m) === 'd2d4');
  check('d2d4 legal in worked ep position', !!mv);
  if (!mv) throw new Error('d2d4 missing');
  const after = applyMove(pos, mv);
  check('ep field is d3 after d2d4', after.ep === 'd3', after.ep);
  // then black e4d3 captures en passant, leaving no white pawn on the board
  const mv2 = legalMoves(after).find(m => uci(m) === 'e4d3');
  check('e4d3 ep capture legal', !!mv2);
  if (!mv2) throw new Error('e4d3 missing');
  const after2 = applyMove(after, mv2);
  check('no white pawn left after ep', !after2.board.some(p => p && p.c === 'w' && p.t === 'p'));
  check('ep field empty after ep capture', after2.ep === null);
}
// after a move that creates no such capture it reads '-'
{
  const pos = parseFen(START_FEN);
  const after = applyMove(pos, legalMoves(pos).find(m => uci(m) === 'e2e4'));
  check('ep field "-" when no capture available', after.ep === null, JSON.stringify(after.ep));
}
// worked: after White answers a black pawn on e4 by pushing d2d4 the field reads d3 (covered above)

// --- mate: 6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1 -> a1a8 is mate, 1-0
{
  const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
  const pos = parseFen(fen);
  const mv = legalMoves(pos).find(m => uci(m) === 'a1a8');
  const after = applyMove(pos, mv);
  const st = statusOf(after);
  check('a1a8 is mate 1-0', st.over && st.reason === 'checkmate' && st.result === '1-0', JSON.stringify(st));
  check('SAN of a1a8 is Ra8#', sanFor(fen, 'a1a8') === 'Ra8#', sanFor(fen, 'a1a8'));
}

// --- capture undefended queen: 4k3/8/8/3q4/8/8/8/3QK3 w -> d1d5
{
  const fen = '4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1';
  check('d1d5 legal (undefended queen capture)', uciSet(fen).has('d1d5'));
  check('house sharp captures undefended queen', houseMove(fen, 'sharp') === 'd1d5', houseMove(fen, 'sharp'));
}

// --- promotion: 6k1/4P3/... e7e8n promotes to knight
{
  const fen = '6k1/4P3/8/8/8/8/8/4K3 w - - 0 1';
  check('e7e8n legal', uciSet(fen).has('e7e8n'));
  check('e7e8q legal', uciSet(fen).has('e7e8q'));
  check('all four promotions present', ['e7e8q','e7e8r','e7e8b','e7e8n'].every(u => uciSet(fen).has(u)));
  check('SAN e7e8n is e8=N', sanFor(fen, 'e7e8n') === 'e8=N', sanFor(fen, 'e7e8n'));
  check('announce promotion', announcementFor(fen, 'e7e8n') === 'Pawn to e8, promoted to Knight', announcementFor(fen, 'e7e8n'));
}

// --- pinned knight: 4k3/4n3/8/8/8/8/8/4R1K1 b -> all knight moves illegal
{
  const fen = '4k3/4n3/8/8/8/8/8/4R1K1 b - - 0 1';
  const set = uciSet(fen);
  for (const u of ['e7c6','e7g6','e7c8','e7g8','e7d5','e7f5']) {
    check(`pinned knight ${u} illegal`, !set.has(u), `${u}`);
  }
}

// --- SAN disambiguation with pinned piece ignored: 4k3/8/8/8/8/8/8/R6R w -> both rooks reach d1
{
  const fen = '4k3/8/8/8/8/8/6K1/R6R w - - 0 1';
  check('Rad1 for a1d1 when both rooks reach d1', sanFor(fen, 'a1d1') === 'Rad1', sanFor(fen, 'a1d1'));
  check('Rhd1 for h1d1', sanFor(fen, 'h1d1') === 'Rhd1', sanFor(fen, 'h1d1'));
}
// pinned piece does not create ambiguity: 4k3/8/8/8/8/8/8/1N2KN1r w -> knight f1 pinned along rank 1, only b1 reaches d2 -> "Nd2"
{
  const fen = '4k3/8/8/8/8/8/8/1N2KN1r w - - 0 1';
  check('Nd2 without disambiguation (f1 knight pinned)', sanFor(fen, 'b1d2') === 'Nd2', sanFor(fen, 'b1d2'));
  const set = uciSet(fen);
  check('f1 knight cannot move (pinned)', !['f1d2','f1e3','f1g3','f1h2'].some(u => set.has(u)));
  check('b1d2 legal', set.has('b1d2'));
}

// --- insufficient material
{
  check('K+B vs K+B same colour insufficient', insufficientMaterial(parseFen('4k3/8/8/3b4/4p3/3B4/8/4K3 w - - 0 1'.replace('4p3','8').replace('3B4','3B4'))));
  // worked: 4k3/8/8/3b4/4p3/3B4/8/4K3 w - material not yet insufficient (pawn on board)
  check('pawn present -> not insufficient', !insufficientMaterial(parseFen('4k3/8/8/3b4/4p3/3B4/8/4K3 w - - 0 1')));
  // after d3e4 captures the last pawn: white B on e4? No: d3 bishop captures e4 pawn, bishops on e4 (light? e4 is light) and d5 (light) => same colour => draw
  const fen = '4k3/8/8/3b4/4p3/3B4/8/4K3 w - - 0 1';
  const pos = parseFen(fen);
  const mv = legalMoves(pos).find(m => uci(m) === 'd3e4');
  check('d3e4 legal', !!mv);
  const after = applyMove(pos, mv);
  check('after capture insufficient', insufficientMaterial(after));
  check('K vs K insufficient', insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1')));
  check('K+N vs K insufficient', insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/3NK3 w - - 0 1')));
  check('K+N+N vs K+N treated insufficient', insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/3NKN2 w - - 0 1'.replace('KN2','KN2'))));
  check('K+B vs K+B different colours NOT insufficient', !insufficientMaterial(parseFen('4k3/8/8/3b4/8/4B3/8/4K3 w - - 0 1')));
}

// --- repetition: r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1; e1f1 e8f8 f1e1 f8e8 -> not a repetition (castling rights lost)
{
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  let cur = parseFen(fen), fens = [toFen(cur)];
  for (const u of ['e1f1','e8f8','f1e1','f8e8']) {
    const mv = legalMoves(cur).find(m => uci(m) === u);
    cur = applyMove(cur, mv);
    fens.push(toFen(cur));
  }
  check('return to start squares is NOT a repetition', repetitionCount(fens) === 1, `count=${repetitionCount(fens)}`);
}
// genuine threefold
{
  let cur = parseFen(START_FEN), fens = [toFen(cur)];
  const seq = ['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8'];
  for (const u of seq) {
    const mv = legalMoves(cur).find(m => uci(m) === u);
    cur = applyMove(cur, mv);
    fens.push(toFen(cur));
  }
  check('threefold counted', repetitionCount(fens) === 3, `count=${repetitionCount(fens)}`);
}

// --- castling
{
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const set = uciSet(fen);
  check('white O-O legal', set.has('e1g1'));
  check('white O-O-O legal', set.has('e1c1'));
  const start = parseFen(fen);
  const afterW = applyMove(start, legalMoves(start).find(m => uci(m) === 'e1g1'));
  check('castling SAN O-O', sanFor(fen, 'e1g1') === 'O-O', sanFor(fen, 'e1g1'));
  const setB = uciSet(toFen(afterW));
  check('black O-O-O legal after (f8 attacked by Rf1 blocks O-O)', setB.has('e8c8'), [...setB].join(' '));
}

// --- stalemate
{
  const fen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
  const st = statusOf(parseFen(fen));
  check('stalemate detected', st.over && st.reason === 'stalemate' && st.result === '1/2-1/2', JSON.stringify(st));
}

// --- halfmove clock and fullmove number
{
  let cur = parseFen(START_FEN);
  cur = applyMove(cur, legalMoves(cur).find(m => uci(m) === 'g1f3'));
  check('halfmove 1 after Nf3', parseFen(toFen(cur)).halfmove === 1);
  cur = applyMove(cur, legalMoves(cur).find(m => uci(m) === 'g8f6'));
  check('halfmove 2, fullmove 2 after black move', cur.halfmove === 2 && cur.fullmove === 2);
  const withPawn = applyMove(parseFen(START_FEN), legalMoves(parseFen(START_FEN)).find(m => uci(m) === 'e2e4'));
  check('halfmove reset on pawn move', withPawn.halfmove === 0);
  check('fullmove stays 1 after white move', withPawn.fullmove === 1);
}

// --- announcements
{
  const fen = START_FEN;
  check('announce Nf3', announcementFor(fen, 'g1f3') === 'Knight to f3', announcementFor(fen, 'g1f3'));
  const m8 = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w kq - 0 1';
  const a = announcementFor(m8, 'f3f7');
  check('announce capture-mate', a === 'Queen takes f7, checkmate', a);
  const checkFen = '4k3/8/8/8/8/8/8/4K2R w - - 0 1';
  check('announce check', announcementFor(checkFen, 'h1h8') === 'Rook to h8, check', announcementFor(checkFen, 'h1h8'));
  const mateFen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
  check('announce checkmate', announcementFor(mateFen, 'a1a8') === 'Rook to a8, checkmate', announcementFor(mateFen, 'a1a8'));
  const capFen = '4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1';
  check('announce capture', announcementFor(capFen, 'd1d5') === 'Queen takes d5', announcementFor(capFen, 'd1d5'));
}

// --- openings
{
  check('opening Italian', openingFor(['e2e4','e7e5','g1f3','b8c6','f1c4']) === 'Italian Game');
  check('opening Ruy Lopez', openingFor(['e2e4','e7e5','g1f3','b8c6','f1b5']) === 'Ruy Lopez');
  check('opening English', openingFor(['c2c4']) === 'English Opening');
  check('opening longest match: London over QG', openingFor(['d2d4','d7d5','g1f3','g8f6','c1f4']) === 'London System', openingFor(['d2d4','d7d5','g1f3','g8f6','c1f4']));
  check('opening Sicilian', openingFor(['e2e4','c7c5']) === 'Sicilian Defence');
  check('opening null when no match', openingFor(['f2f3']) === null);
  check('opening Slav', openingFor(['d2d4','d7d5','c2c4','c7c6']) === 'Slav Defence');
  check('opening partial: 2 moves of Italian', openingFor(['e2e4','e7e5']) === null);
}

// --- ratings
{
  check('step 40 under 30 games', stepFactor(1500, 29) === 40);
  check('step 20 at 30 games under 2400', stepFactor(2399, 30) === 20);
  check('step 10 at 2400', stepFactor(2400, 64) === 10);
  // symmetric expectation: 1500 vs 1500, white wins: +20/-20 at K=40
  const d = ratingDeltas(1500, 10, 1500, 10, 1);
  check('symmetric deltas 1500v1500 K40 win', d.white === 20 && d.black === -20, JSON.stringify(d));
  // 0.5 rounds half away from zero: 1515 vs 1480 -> E = 1/(1+10^(-35/400)) = 0.55...
  const d2 = ratingDeltas(1515, 5, 1480, 42, 1);
  check('deltas computed from pre-game numbers', Number.isInteger(d2.white) && Number.isInteger(d2.black), JSON.stringify(d2));
  check('display has ? under 10 games', ratingDisplay(1500, 9) === '1500?');
  check('display plain at 10 games', ratingDisplay(1500, 10) === '1500');
  check('clamp at 100', clampRating(90) === 100);
  // rounding half away from zero
  const d3 = ratingDeltas(2400, 100, 2400, 100, 0.5);
  check('equal ratings draw -> zero delta', d3.white === 0 && d3.black === 0, JSON.stringify(d3));
}

// --- house determinism
{
  const fens = ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1','r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w kq - 0 1'];
  for (const f of fens) for (const lvl of ['easy','steady','sharp']) {
    const a = houseMove(f, lvl), b = houseMove(f, lvl);
    check(`house deterministic ${f.slice(0,12)} ${lvl}`, a === b && !!a, `${a} vs ${b}`);
  }
  // mate in one at sharp
  const mateFen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
  check('house sharp mates in one', houseMove(mateFen, 'sharp') === 'a1a8', houseMove(mateFen, 'sharp'));
  // house plays only legal moves
  const set = uciSet(START_FEN);
  check('house move legal from start', set.has(houseMove(START_FEN, 'sharp')));
}

// --- FEN round-trip
{
  const f = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  check('fen round trip', toFen(parseFen(f)) === f, toFen(parseFen(f)));
}

console.log(`PASS ${passed} FAIL ${failed}`);
if (failed) { failures.forEach(f => console.log('  FAIL:', f)); process.exit(1); }
