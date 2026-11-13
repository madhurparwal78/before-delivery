// Verifies the typing engine against the two published worked examples.
// Run with: npx tsx scripts/check-engine.ts (or compiled output).
import { replayLog, perSecondSpeeds } from '../src/shared/scoring.js';
import type { LogEntry } from '../src/shared/engine.js';
import { roundHalfUp2 } from '../src/shared/format.js';

function seq(keys: string[], stepMs: number): LogEntry[] {
  return keys.map((k, i) => ({ k, t: i * stepMs }));
}

function check(label: string, got: unknown, want: unknown): void {
  const g = typeof got === 'number' ? roundHalfUp2(got) : got;
  const w = typeof want === 'number' ? roundHalfUp2(want) : want;
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(g)}${ok ? '' : ` want ${JSON.stringify(w)}`}`);
  if (!ok) process.exitCode = 1;
}

// Worked example 1: words test "the cat sat".
{
  const words = ['the', 'cat', 'sat'];
  const keys = ['t', 'h', 'e', 'Space', 'c', 'x', 'Backspace', 'a', 't', 'Space', 's', 'a', 't'];
  const log = seq(keys, 200);
  check('entries', log.length, 13);
  const replay = replayLog(words, log, { maxExtraLetters: 10, timeLimitMs: null });
  check('duration', replay.durationMs, 2400);
  check('keystrokes', replay.score.keystrokes, 12);
  check('correctKeystrokes', replay.score.correctKeystrokes, 11);
  check('speed', replay.figures.speed, 55);
  check('raw', replay.figures.raw, 60);
  check('accuracy', replay.figures.accuracy, 91.67);
  const raws = replay.perSecondRaw.map((s) => roundHalfUp2(s.keystrokes * 12000 / (Math.min(s.second*1000, replay.durationMs) - (s.second-1)*1000)));
  check('per-second raw', raws, [60, 48, 90]);
  check('consistency', replay.figures.consistency, 73.24);
  check('characters', replay.score.characters, { correct: 9, incorrect: 0, extra: 0, missed: 0 });
  check('errorsByKey', replay.score.errorsByKey, { a: 1 });
  const speeds = perSecondSpeeds(replay.figures.speed, words, log, { maxExtraLetters: 10, timeLimitMs: null }, replay.durationMs).map(roundHalfUp2);
  check('per-second speed', speeds, [60, 48, 55]);
  check('per-second errors', replay.perSecondRaw.map((s) => s.errors), [0, 1, 0]);
}

// Worked example 2: 2-second time test.
{
  const words = ['sun', 'map', 'red', 'ink', 'toy'];
  const keys = ['s', 'u', 'n', 'Space', 'm', 'o', 'p', 'Space', 'r', 'e', 'd', 'd', 'Space', 'i'];
  const log = seq(keys, 150).map((e, i) => ({ ...e, t: i * 150 }));
  // The rule: keys at or after 2000ms are ignored, so keep 14 entries within the limit.
  const replay = replayLog(words, log, { maxExtraLetters: 10, timeLimitMs: 2000 });
  check('time keystrokes', replay.score.keystrokes, 14);
  check('time correctKeystrokes', replay.score.correctKeystrokes, 10);
  check('time speed', replay.figures.speed, 30);
  check('time raw', replay.figures.raw, 84);
  check('time accuracy', replay.figures.accuracy, 71.43);
  check('time consistency', replay.figures.consistency, 100);
  check('time characters', replay.score.characters, { correct: 9, incorrect: 1, extra: 1, missed: 0 });
  check('time errorsByKey', replay.score.errorsByKey, { a: 1, space: 2, extra: 1 });
}
console.log('done');
