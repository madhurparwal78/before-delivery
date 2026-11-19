import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResult, stepFactor, roundHalfAwayFromZero, ratingDisplay } from '../src/ratings.js';
import { exportRecord, importRecord, openingFor, formatDate } from '../src/record.js';
import { houseMove } from '../src/house.js';
import { START_FEN, playMove, parseFen, legalMovesUci } from '../src/chess.js';

test('step factors follow the published bands', () => {
  assert.equal(stepFactor(1500, 10), 40);
  assert.equal(stepFactor(1500, 30), 20);
  assert.equal(stepFactor(2400, 64), 10);
  assert.equal(stepFactor(2400, 29), 40);
});

test('rounding is half away from zero', () => {
  assert.equal(roundHalfAwayFromZero(0.5), 1);
  assert.equal(roundHalfAwayFromZero(-0.5), -1);
  assert.equal(roundHalfAwayFromZero(2.49), 2);
  assert.equal(roundHalfAwayFromZero(-2.5), -3);
});

test('both ratings move from the pre-game numbers and are symmetric', () => {
  const out = applyResult({
    white: { rating: 1480, rated_games: 42 },
    black: { rating: 2412, rated_games: 64 },
    result: '1-0',
  });
  // White: K 20 (1480 < 2400, 42 games); Black: K 10 (2412 >= 2400).
  assert.equal(out.white.step, 20);
  assert.equal(out.black.step, 10);
  assert.equal(out.white.rating_after, 1480 + 20);
  assert.equal(out.black.rating_after, 2412 - 10);
});

test('a rating never falls below 100 and the winner is unaffected', () => {
  const out = applyResult({
    white: { rating: 100, rated_games: 5 },
    black: { rating: 105, rated_games: 5 },
    result: '1-0',
  });
  assert.equal(out.black.rating_after, 100, 'the floor holds at 100');
  assert.ok(out.black.raw_delta < -5, 'the raw change went below the floor');
  assert.ok(out.white.rating_after > 100, 'the winner is unaffected by the loser clamp');
  const provisional = applyResult({
    white: { rating: 1190, rated_games: 6 },
    black: { rating: 1190, rated_games: 6 },
    result: '1/2-1/2',
  });
  assert.equal(provisional.white.delta, 0);
  assert.equal(ratingDisplay(1190, 6), '1190?');
  assert.equal(ratingDisplay(1480, 42), '1480');
});

test('openings match by the longest leading sequence', () => {
  assert.equal(openingFor(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4']), 'Italian Game');
  assert.equal(openingFor(['e2e4', 'c7c5', 'g1f3']), 'Sicilian Defence');
  assert.equal(openingFor(['d2d4', 'd7d5', 'c2c4', 'c7c6']), 'Slav Defence');
  assert.equal(openingFor(['d2d4', 'd7d5', 'c2c4', 'g8f6']), 'Queens Gambit');
  assert.equal(openingFor(['c2c4', 'e7e5']), 'English Opening');
  assert.equal(openingFor(['g1f3']), null);
});

test('a record exports with its seven tags in order and imports back exactly', () => {
  let fen = START_FEN;
  const moves = [];
  for (const uci of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5']) {
    const played = playMove(fen, uci);
    moves.push(played);
    fen = played.fen;
  }
  const text = exportRecord({
    white_username: 'mira_kade',
    black_username: 'wren_oyelaran',
    result: '*',
    created_at: new Date(Date.UTC(2026, 0, 9)),
  }, moves);
  const tagLines = text.split('\n').filter((l) => l.startsWith('['));
  assert.deepEqual(tagLines.map((l) => l.slice(1, l.indexOf(' '))), [
    'Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result',
  ]);
  assert.ok(text.includes('[Date "2026.01.09"]'));
  assert.ok(text.includes('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5'));
  const imported = importRecord(text);
  assert.equal(imported.fen, fen);
  assert.equal(imported.opening, 'Italian Game');
  assert.equal(imported.tags.White, 'mira_kade');
});

test('an invalid record is refused naming the line that failed', () => {
  const text = [
    '[Event "Gambit Hall Club"]',
    '[Site "Gambit Hall"]',
    '[Date "2026.01.09"]',
    '[Round "1"]',
    '[White "a_member"]',
    '[Black "b_member"]',
    '[Result "*"]',
    '',
    '1. e4 e5',
    '2. Nf3 Rh6',
    '*',
  ].join('\n');
  assert.throws(() => importRecord(text), (error) => {
    assert.equal(error.line, 10);
    assert.match(error.message, /line 10/);
    return true;
  });
});

test('the house is deterministic, legal, and takes a mate in one at sharp', () => {
  const mateFen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
  assert.equal(houseMove(mateFen, 'sharp'), 'a1a8');
  const queenFen = '4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1';
  assert.equal(houseMove(queenFen, 'sharp'), 'd1d5');
  for (const level of ['easy', 'steady', 'sharp']) {
    const first = houseMove(START_FEN, level);
    for (let i = 0; i < 4; i++) assert.equal(houseMove(START_FEN, level), first);
    assert.ok(legalMovesUci(parseFen(START_FEN)).includes(first));
  }
});

test('the house plays only legal moves over a whole game', () => {
  for (const level of ['easy', 'steady', 'sharp']) {
    let fen = START_FEN;
    for (let i = 0; i < 40; i++) {
      const uci = houseMove(fen, level);
      if (!uci) break;
      assert.ok(legalMovesUci(parseFen(fen)).includes(uci), `${uci} illegal at ${fen}`);
      fen = playMove(fen, uci).fen;
    }
  }
});

test('dates are formatted in UTC', () => {
  assert.equal(formatDate('2026-03-04T23:30:00Z'), '2026.03.04');
});
