import test from 'node:test';
import assert from 'node:assert/strict';
import {
  START_FEN, parseFen, toFen, legalMovesUci, playMove, terminalState, availableClaims,
  positionKey, hasInsufficientMaterial, findMove, boardSquares,
} from '../src/chess.js';

test('the starting position has exactly 20 legal moves', () => {
  assert.equal(legalMovesUci(parseFen(START_FEN)).length, 20);
  assert.equal(toFen(parseFen(START_FEN)), START_FEN);
  assert.equal(boardSquares(START_FEN).length, 64);
  assert.equal(boardSquares(START_FEN)[0].name, 'a8');
  assert.equal(boardSquares(START_FEN).find((s) => s.name === 'e2').pieceName, 'White Pawn');
});

test('en passant: the field names a square only when the capture is available', () => {
  const after = playMove('4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1', 'd2d4');
  assert.equal(after.fen.split(' ')[3], 'd3');
  const cap = playMove(after.fen, 'e4d3');
  assert.equal(cap.capture, true);
  assert.equal(cap.enPassant, true);
  assert.ok(!cap.fen.split(' ')[0].includes('P'));
  const quiet = playMove('4k3/8/8/8/8/8/3P4/4K3 w - - 0 1', 'd2d4');
  assert.equal(quiet.fen.split(' ')[3], '-');
});

test('back rank mate ends the game 1-0', () => {
  const after = playMove('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8');
  assert.equal(after.san, 'Ra8#');
  assert.equal(after.announcement, 'Rook to a8, checkmate');
  const state = terminalState(after.fen, [positionKey(after.fen)]);
  assert.deepEqual(state, { over: true, reason: 'checkmate', result: '1-0' });
});

test('capturing an undefended queen', () => {
  const after = playMove('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1', 'd1d5');
  assert.equal(after.capture, true);
  assert.equal(after.announcement, 'Queen takes d5');
  assert.equal(after.san, 'Qxd5');
});

test('promotion to a knight', () => {
  const after = playMove('6k1/4P3/8/8/8/8/8/4K3 w - - 0 1', 'e7e8n');
  assert.equal(after.san, 'e8=N');
  assert.equal(after.announcement, 'Pawn to e8, promoted to Knight');
  assert.equal(after.promotion, 'n');
  const promos = legalMovesUci(parseFen('6k1/4P3/8/8/8/8/8/4K3 w - - 0 1')).filter((m) => m.startsWith('e7e8'));
  assert.deepEqual(promos, ['e7e8b', 'e7e8n', 'e7e8q', 'e7e8r']);
});

test('a pinned knight has no legal move', () => {
  const fen = '4k3/4n3/8/8/8/8/8/4R1K1 b - - 0 1';
  const position = parseFen(fen);
  for (const uci of ['e7c6', 'e7g6', 'e7c8', 'e7g8', 'e7d5', 'e7f5']) {
    assert.equal(findMove(position, uci), null, `${uci} must be illegal`);
  }
});

test('a pinned piece creates no notation ambiguity', () => {
  const after = playMove('4k3/8/8/8/8/8/8/1N2KN1r w - - 0 1', 'b1d2');
  assert.equal(after.san, 'Nd2');
});

test('two rooks reaching one square are disambiguated by file', () => {
  const after = playMove('4k3/8/8/8/8/8/6K1/R6R w - - 0 1', 'a1d1');
  assert.equal(after.san, 'Rad1');
});

test('insufficient material: same-coloured bishops draw at once', () => {
  const fen = '4k3/8/8/3b4/4p3/3B4/8/4K3 w - - 0 1';
  assert.equal(hasInsufficientMaterial(fen), false);
  const after = playMove(fen, 'd3e4');
  const state = terminalState(after.fen, [positionKey(after.fen)]);
  assert.equal(state.reason, 'insufficient material');
  assert.equal(state.result, '1/2-1/2');
});

test('losing castling rights means the position is not a repetition', () => {
  let fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const history = [positionKey(fen)];
  for (const uci of ['e1f1', 'e8f8', 'f1e1', 'f8e8']) {
    fen = playMove(fen, uci).fen;
    history.push(positionKey(fen));
  }
  assert.equal(availableClaims(fen, history).threefold, false);
  assert.notEqual(positionKey(fen), history[0]);
});

test('the halfmove clock resets and the fullmove number rises', () => {
  let fen = START_FEN;
  fen = playMove(fen, 'g1f3').fen;
  assert.equal(fen.split(' ')[4], '1');
  assert.equal(fen.split(' ')[5], '1');
  fen = playMove(fen, 'g8f6').fen;
  assert.equal(fen.split(' ')[4], '2');
  assert.equal(fen.split(' ')[5], '2');
  fen = playMove(fen, 'e2e4').fen;
  assert.equal(fen.split(' ')[4], '0', 'a pawn move resets the clock');
});

test('castling is generated and plays both rook and king', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const moves = legalMovesUci(parseFen(fen));
  assert.ok(moves.includes('e1g1'));
  assert.ok(moves.includes('e1c1'));
  const after = playMove(fen, 'e1g1');
  assert.equal(after.san, 'O-O');
  assert.equal(after.fen.split(' ')[0], 'r3k2r/8/8/8/8/8/8/R4RK1');
  assert.equal(after.fen.split(' ')[2], 'kq');
});

test('fifty-move claim only holds at a hundred plies', () => {
  const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 99 60';
  assert.equal(availableClaims(fen, [positionKey(fen)])['fifty-move'], false);
  const after = playMove(fen, 'a1a2');
  assert.equal(after.fen.split(' ')[4], '100');
  assert.equal(availableClaims(after.fen, [positionKey(after.fen)])['fifty-move'], true);
});

test('threefold and fivefold repetition', () => {
  let fen = '4k3/8/8/8/8/8/8/R3K2R w - - 0 1';
  const history = [positionKey(fen)];
  const cycle = ['a1b1', 'e8d8', 'b1a1', 'd8e8'];
  const counts = [];
  for (let i = 0; i < 4; i++) {
    for (const uci of cycle) {
      fen = playMove(fen, uci).fen;
      history.push(positionKey(fen));
    }
    counts.push(history.filter((k) => k === history[0]).length);
  }
  assert.deepEqual(counts, [2, 3, 4, 5]);
  assert.equal(terminalState(fen, history).reason, 'fivefold repetition');
});

test('a move leaving the own king in check is not generated', () => {
  const fen = '4k3/4r3/8/8/8/8/8/4R2K b - - 0 1';
  assert.equal(findMove(parseFen(fen), 'e7d7'), null);
  assert.ok(findMove(parseFen(fen), 'e7e1'));
});

test('stalemate is detected', () => {
  const state = terminalState('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', []);
  assert.deepEqual(state, { over: true, reason: 'stalemate', result: '1/2-1/2' });
});
