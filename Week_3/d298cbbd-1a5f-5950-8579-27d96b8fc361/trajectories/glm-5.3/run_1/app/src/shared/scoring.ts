import { applyEntry, countCharacters, endByClock, initialEngineState, KEY_SPACE, consistencyFrom, perSecondCounts, wpm, accuracyOf, type EngineOptions, type LogEntry, type Score, type SecondCount } from './engine.js';

// The derived figures every view of a run shares.

export interface SecondValues { second: number; speed: number; raw: number; errors: number }

export interface ReplayResult {
  score: Score;
  durationMs: number;
  seconds: number;
  perSecondRaw: SecondCount[];
  figures: { speed: number; raw: number; accuracy: number; consistency: number };
}

interface Slice {
  state: ReturnType<typeof initialEngineState>;
  keystrokes: number;
  correctKeystrokes: number;
  correctWordCharacters: number;
  keystrokesAt: { t: number; correct: boolean }[];
  errorsByKey: Record<string, number>;
  ended: boolean;
}

/**
 * Replay the entries whose `t` is below `cutoff` (null for all of them).
 * One pass shared by the full replay and every per-second slice.
 */
function replaySlice(words: readonly string[], log: readonly LogEntry[], opts: EngineOptions, cutoff: number | null): Slice {
  const state = initialEngineState(words);
  const wordsMode = opts.timeLimitMs === null;
  const slice: Slice = { state, keystrokes: 0, correctKeystrokes: 0, correctWordCharacters: 0, keystrokesAt: [], errorsByKey: {}, ended: false };
  let done = false;

  for (const entry of log) {
    if (cutoff !== null && entry.t >= cutoff) break;
    const before = state.wordIndex;
    const outcome = applyEntry(state, entry, opts);
    if (outcome === null) continue;
    if (outcome.keystroke) {
      slice.keystrokes++;
      if (outcome.correct) slice.correctKeystrokes++;
      else {
        const key = outcome.errorKey ?? 'extra';
        slice.errorsByKey[key] = (slice.errorsByKey[key] ?? 0) + 1;
      }
      slice.keystrokesAt.push({ t: entry.t, correct: outcome.correct });
    }
    // A Space that moved on counts the word it leaves, Space included; a
    // Space that ends the test counts the last word the same way.
    if (entry.k === KEY_SPACE && outcome.keystroke) {
      const leftWord = state.words[outcome.ended ? state.words.length - 1 : before];
      if (leftWord.typed === leftWord.word) slice.correctWordCharacters += leftWord.word.length + 1;
    }
    if (outcome.ended) {
      if (wordsMode && entry.k !== KEY_SPACE) {
        const lastWord = state.words[state.words.length - 1];
        if (lastWord.typed === lastWord.word) slice.correctWordCharacters += lastWord.word.length;
      }
      slice.ended = true;
      done = true;
      break;
    }
  }

  // The word the clock stopped in: its typed letters when they are an exact
  // prefix of the word, and otherwise nothing.
  if (!done) {
    const openWord = state.words[state.wordIndex];
    if (openWord !== undefined && openWord.word.startsWith(openWord.typed)) slice.correctWordCharacters += openWord.typed.length;
    if (!wordsMode) endByClock(state, cutoff ?? opts.timeLimitMs ?? 0);
  }

  return slice;
}

/**
 * Replays a log and returns the score plus every derived figure.
 * For time tests the caller passes the test length as timeLimitMs.
 */
export function replayLog(words: readonly string[], log: readonly LogEntry[], opts: EngineOptions): ReplayResult {
  const whole = replaySlice(words, log, opts, null);
  const state = whole.state;
  const durationMs = state.durationMs ?? 0;
  const chars = countCharacters(state.words, state.words.length - 1);
  const score: Score = {
    durationMs,
    correctWordCharacters: whole.correctWordCharacters,
    keystrokes: whole.keystrokes,
    correctKeystrokes: whole.correctKeystrokes,
    characters: chars,
    errorsByKey: whole.errorsByKey,
    words: state.words,
    ended: whole.ended,
  };

  const counts = perSecondCounts(whole.keystrokesAt, durationMs);
  const seconds = counts.length;
  const raws: number[] = [];
  for (const c of counts) {
    const from = (c.second - 1) * 1000;
    const to = Math.min(c.second * 1000, durationMs);
    raws.push(to > from ? (c.keystrokes * 12000) / (to - from) : 0);
  }
  const { speed, raw } = wpm(whole.correctWordCharacters, whole.keystrokes, durationMs);
  return {
    score,
    durationMs,
    seconds,
    perSecondRaw: counts,
    figures: { speed, raw, accuracy: accuracyOf(whole.correctKeystrokes, whole.keystrokes), consistency: consistencyFrom(raws) },
  };
}

/**
 * Per-second speed: for second k, the Speed of the keystrokes with t below
 * k × 1000, scored as a time test of k seconds. The last second shows the
 * final Speed.
 */
export function perSecondSpeeds(finalSpeed: number, words: readonly string[], log: readonly LogEntry[], opts: EngineOptions, durationMs: number): number[] {
  const seconds = Math.ceil(durationMs / 1000);
  const speeds: number[] = [];
  for (let k = 1; k <= seconds; k++) {
    if (k * 1000 >= durationMs) {
      speeds.push(finalSpeed);
      continue;
    }
    const sliceOpts: EngineOptions = { ...opts, timeLimitMs: k * 1000 };
    const slice = replaySlice(words, log, sliceOpts, k * 1000);
    speeds.push(wpm(slice.correctWordCharacters, slice.keystrokes, k * 1000).speed);
  }
  return speeds;
}

/** The errors-by-key table rows in the published order. */
export function errorsByKeyRows(errorsByKey: Record<string, number>): { key: string; errors: number }[] {
  return Object.entries(errorsByKey)
    .map(([key, errors]) => ({ key, errors }))
    .sort((a, b) => (a.errors !== b.errors ? b.errors - a.errors : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
