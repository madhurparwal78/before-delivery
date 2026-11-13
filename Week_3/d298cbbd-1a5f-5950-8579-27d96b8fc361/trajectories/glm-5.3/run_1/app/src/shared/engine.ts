import { HOLLOWAY_120 } from '../wordlist.js';
import { QUOTES } from '../quotes.js';

// The one published typing and scoring implementation, run by the test sheet,
// the carbon replay, the race page and the server replay.

export type TestMode = 'time' | 'words' | 'quote' | 'custom';
export type QuoteLength = 'short' | 'medium' | 'long' | 'all';
export type LetterState = 'untyped' | 'correct' | 'incorrect' | 'extra' | 'missed' | 'typed';

export const KEY_SPACE = 'Space';
export const KEY_BACKSPACE = 'Backspace';
export const KEY_CTRL_BACKSPACE = 'CtrlBackspace';

export interface LogEntry { k: string; t: number }
export type KeystrokeLog = LogEntry[];

export interface WordView {
  word: string;
  typed: string;
  missed: number;
}

export interface Score {
  durationMs: number;
  correctWordCharacters: number;
  keystrokes: number;
  correctKeystrokes: number;
  characters: { correct: number; incorrect: number; extra: number; missed: number };
  errorsByKey: Record<string, number>;
  words: WordView[];
  ended: boolean;
}

// mulberry32, exactly as published.
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFor(base: number, sequence: number): number {
  return (base + sequence) % 4294967296;
}

// Words for a seed, exactly as published.
export function generateWords(seed: number, count: number, punctuation: boolean, numbers: boolean): string[] {
  const r = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let w = HOLLOWAY_120[Math.floor(r() * 120)];
    while (w === out[out.length - 1]) w = HOLLOWAY_120[Math.floor(r() * 120)];
    if (numbers) {
      const x = r();
      if (x < 0.15) w = String(Math.floor(r() * 1000));
    }
    if (punctuation) {
      const y = r();
      if (y < 0.1) w += ',';
      else if (y < 0.2) w += '.';
    }
    if (punctuation && (i === 0 || (out[out.length - 1] ?? '').endsWith('.'))) w = w.charAt(0).toUpperCase() + w.slice(1);
    out.push(w);
  }
  return out;
}

export function timeWordCount(lengthSeconds: number): number {
  return lengthSeconds * 4;
}

export function quotePick(seed: number, group: QuoteLength | 'all'): { quoteId: string; words: string[]; source: string } {
  const pool = group === 'all' ? QUOTES.slice() : QUOTES.filter((q) => q.group === group);
  const pick = pool[Math.floor(mulberry32(seed)() * pool.length)];
  return { quoteId: pick.id, words: pick.text.split(' '), source: pick.source };
}

export function quoteSourceFor(quoteId: string | null): string | null {
  const q = QUOTES.find((x) => x.id === quoteId);
  return q ? q.source : null;
}

export function isLetterKey(k: string): boolean {
  return k.length === 1 && k !== ' ';
}

export function isLoggedKey(k: string): boolean {
  return k === KEY_SPACE || k === KEY_BACKSPACE || k === KEY_CTRL_BACKSPACE || isLetterKey(k);
}

export interface EngineOptions {
  maxExtraLetters: number;
  timeLimitMs: number | null;
}

export interface EngineState {
  words: WordView[];
  wordIndex: number;
  ended: boolean;
  durationMs: number | null;
}

export function initialEngineState(text: readonly string[]): EngineState {
  return { words: text.map((word) => ({ word, typed: '', missed: 0 })), wordIndex: 0, ended: false, durationMs: null };
}

export interface KeyOutcome {
  /** true when the entry is a keystroke for accuracy, raw speed and errors */
  keystroke: boolean;
  correct: boolean;
  /** the key the error counts under, when incorrect */
  errorKey: string | null;
  ended: boolean;
}

/**
 * Apply one log entry. Returns null when the entry is ignored entirely
 * (after the time limit, after the end, or past the extra-letter cap).
 */
export function applyEntry(state: EngineState, entry: LogEntry, opts: EngineOptions): KeyOutcome | null {
  if (state.ended) return null;
  const { k, t } = entry;
  if (opts.timeLimitMs !== null && t >= opts.timeLimitMs) return null;
  const current = state.words[state.wordIndex];
  if (current === undefined) return null;

  const lastWord = state.wordIndex === state.words.length - 1;
  const wordsMode = opts.timeLimitMs === null;

  if (k === KEY_BACKSPACE || k === KEY_CTRL_BACKSPACE) {
    if (current.typed.length > 0) {
      current.typed = k === KEY_BACKSPACE ? current.typed.slice(0, -1) : '';
      return { keystroke: false, correct: false, errorKey: null, ended: false };
    }
    const previous = state.words[state.wordIndex - 1];
    if (previous !== undefined && previous.typed !== previous.word) {
      state.wordIndex -= 1;
      previous.missed = 0;
      if (k === KEY_CTRL_BACKSPACE) previous.typed = '';
      return { keystroke: false, correct: false, errorKey: null, ended: false };
    }
    return null;
  }

  if (k === KEY_SPACE) {
    if (current.typed.length === 0) return null;
    const exact = current.typed === current.word;
    if (lastWord && wordsMode) {
      state.ended = true;
      state.durationMs = t;
      return { keystroke: true, correct: exact, errorKey: exact ? null : 'space', ended: true };
    }
    if (lastWord) return null; // a time test's last word: Space does nothing
    current.missed = Math.max(0, current.word.length - current.typed.length);
    state.wordIndex += 1;
    return { keystroke: true, correct: exact, errorKey: exact ? null : 'space', ended: false };
  }

  if (current.typed.length >= current.word.length + opts.maxExtraLetters) return null;
  const position = current.typed.length;
  const isExtra = position >= current.word.length;
  const correct = !isExtra && current.word.charAt(position) === k;
  current.typed += k;
  const finishes = !isExtra && current.typed === current.word && lastWord && wordsMode;
  if (finishes) {
    state.ended = true;
    state.durationMs = t;
  }
  return { keystroke: true, correct, errorKey: correct ? null : isExtra ? 'extra' : current.word.charAt(position), ended: finishes };
}

/** End a time test by its clock. */
export function endByClock(state: EngineState, durationMs: number): void {
  if (state.ended) return;
  state.ended = true;
  state.durationMs = durationMs;
}

export interface SecondCount { second: number; keystrokes: number; errors: number }

/** Keystrokes and errors per second, with the last interval closed at the duration. */
export function perSecondCounts(keystrokesAt: readonly { t: number; correct: boolean }[], durationMs: number): SecondCount[] {
  const seconds = Math.ceil(durationMs / 1000);
  const out: SecondCount[] = [];
  for (let k = 1; k <= seconds; k++) {
    const from = (k - 1) * 1000;
    const to = Math.min(k * 1000, durationMs);
    let keystrokes = 0;
    let errors = 0;
    for (const ks of keystrokesAt) {
      const inInterval = ks.t >= from && (ks.t < to || (k === seconds && ks.t === durationMs));
      if (inInterval) {
        keystrokes++;
        if (!ks.correct) errors++;
      }
    }
    out.push({ second: k, keystrokes, errors });
  }
  return out;
}

/** Speed and raw speed for a duration, correct-word characters and keystrokes. */
export function wpm(correctWordCharacters: number, keystrokes: number, durationMs: number): { speed: number; raw: number } {
  const minutes = durationMs / 60000;
  if (minutes === 0) return { speed: 0, raw: 0 };
  return { speed: correctWordCharacters / 5 / minutes, raw: keystrokes / 5 / minutes };
}

export function accuracyOf(correctKeystrokes: number, keystrokes: number): number {
  return keystrokes === 0 ? 100 : (100 * correctKeystrokes) / keystrokes;
}

export function consistencyFrom(counts: readonly number[]): number {
  if (counts.length === 0) return 0;
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  if (mean === 0) return 0;
  const variance = counts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / counts.length;
  return Math.max(0, 100 - (100 * Math.sqrt(variance)) / mean);
}

/**
 * The single scoring pass: replays a log and returns every published figure.
 * `timeLimitMs` is null for words, quote, custom and race tests.
 */
export function scoreLog(words: readonly string[], log: readonly LogEntry[], opts: EngineOptions): Score {
  const state = initialEngineState(words);
  const wordsMode = opts.timeLimitMs === null;
  const keystrokesAt: { t: number; correct: boolean }[] = [];
  const errorsByKey: Record<string, number> = {};
  let keystrokes = 0;
  let correctKeystrokes = 0;
  let correctWordCharacters = 0;

  for (const entry of log) {
    const before = state.wordIndex;
    const outcome = applyEntry(state, entry, opts);
    if (outcome === null) continue;
    if (outcome.keystroke) {
      keystrokes++;
      if (outcome.correct) correctKeystrokes++;
      else {
        const key = outcome.errorKey ?? 'extra';
        errorsByKey[key] = (errorsByKey[key] ?? 0) + 1;
      }
      keystrokesAt.push({ t: entry.t, correct: outcome.correct });
    }
    if (wordsMode && !outcome.ended && entry.k === KEY_SPACE && outcome.keystroke) {
      const leftWord = state.words[before];
      if (leftWord.typed === leftWord.word) correctWordCharacters += leftWord.word.length + 1;
    }
    if (outcome.ended) {
      if (wordsMode && entry.k === KEY_SPACE) {
        const lastWord = state.words[state.words.length - 1];
        if (lastWord.typed === lastWord.word) correctWordCharacters += lastWord.word.length + 1;
      } else if (wordsMode) {
        correctWordCharacters += entry.k.length;
      }
      break;
    }
  }

  const durationMs = state.durationMs ?? 0;
  const chars = countCharacters(state.words, state.words.length - 1);
  return { durationMs, correctWordCharacters, keystrokes, correctKeystrokes, characters: chars, errorsByKey, words: state.words, ended: state.ended };
}

/** Character counts over the final typed state of every word reached. */
export function countCharacters(words: readonly WordView[], lastReached: number): { correct: number; incorrect: number; extra: number; missed: number } {
  let correct = 0;
  let incorrect = 0;
  let extra = 0;
  let missed = 0;
  for (let i = 0; i <= lastReached && i < words.length; i++) {
    const w = words[i];
    for (let j = 0; j < w.typed.length; j++) {
      if (j < w.word.length) (w.word.charAt(j) === w.typed.charAt(j) ? correct++ : incorrect++);
      else extra++;
    }
    missed += w.missed;
  }
  return { correct, incorrect, extra, missed };
}
