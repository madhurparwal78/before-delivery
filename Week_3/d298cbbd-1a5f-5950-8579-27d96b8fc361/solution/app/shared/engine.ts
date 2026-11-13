/** The one typing engine: the test sheet, the carbon replay, the race page and the server replay all run it. */

import { type Ratio, ratioValue } from "./numbers";

type KeyName = string;

export interface LogEntry {
  readonly k: string;
  readonly t: number;
}

export type LetterState = "untyped" | "correct" | "incorrect" | "extra" | "missed" | "typed";

export interface Characters {
  readonly correct: number;
  readonly incorrect: number;
  readonly extra: number;
  readonly missed: number;
}

interface SecondRow {
  readonly second: number;
  readonly speed: Ratio;
  readonly raw: Ratio;
  readonly errors: number;
}

export interface RunScore {
  readonly duration: number;
  readonly speed: Ratio;
  readonly raw: Ratio;
  readonly accuracy: Ratio;
  readonly consistency: number;
  readonly characters: Characters;
  readonly perSecond: readonly SecondRow[];
  readonly errorsByKey: readonly (readonly [string, number])[];
}

export interface EngineRules {
  /** Length of a time test in milliseconds, or null for words, quote, custom and race tests. */
  readonly timeLimitMs: number | null;
  readonly maxExtraLetters: number;
}

interface Keystroke {
  readonly t: number;
  readonly correct: boolean;
  /** The key the typist should have pressed, `space` or `extra`; null for a correct keystroke. */
  readonly miskeyed: string | null;
}

export const SPACE = "Space";
export const BACKSPACE = "Backspace";
export const CTRL_BACKSPACE = "CtrlBackspace";

export function isLoggableKey(key: unknown): key is KeyName {
  return typeof key === "string" && (key === SPACE || key === BACKSPACE || key === CTRL_BACKSPACE || [...key].length === 1);
}

export class TypingEngine {
  readonly log: LogEntry[] = [];
  private readonly typed: string[][];
  private readonly keystrokes: Keystroke[] = [];
  private current = 0;
  private finished = false;
  private endedBySpace = false;
  private endedAt: number | null = null;
  /** Characters of words already left with Space and typed exactly, counting each Space. */
  private leftCorrectChars = 0;
  private wordsCorrect = 0;

  constructor(
    readonly words: readonly string[],
    readonly rules: EngineRules,
  ) {
    this.typed = words.map(() => []);
  }

  get ended(): boolean {
    return this.finished;
  }

  get currentWord(): number {
    return this.current;
  }

  get currentLetter(): number {
    return this.typed[this.current]!.length;
  }

  typedLetters(index: number): readonly string[] {
    return this.typed[index]!;
  }

  /** Words left with Space plus the last word when it ended the test, all typed exactly. */
  get wordsCompletedCorrectly(): number {
    return this.wordsCorrect;
  }

  /** Applies one key. Returns false when the key is ignored and not logged: the test is over or its time is up. */
  apply(entry: LogEntry): boolean {
    if (this.finished || (this.rules.timeLimitMs !== null && entry.t >= this.rules.timeLimitMs)) return false;
    this.log.push(entry);
    const { k, t } = entry;
    const word = this.words[this.current]!;
    const typed = this.typed[this.current]!;
    if (k === SPACE) this.space(t, word, typed);
    else if (k === BACKSPACE) this.backspace(typed);
    else if (k === CTRL_BACKSPACE) this.ctrlBackspace(typed);
    else this.letter(k, t, word, typed);
    return true;
  }

  private space(t: number, word: string, typed: string[]): void {
    if (typed.length === 0) return;
    const exact = typed.join("") === word;
    const isLast = this.current === this.words.length - 1;
    if (isLast && this.rules.timeLimitMs !== null) return;
    this.keystrokes.push({ t, correct: exact, miskeyed: exact ? null : "space" });
    if (isLast) {
      this.finished = true;
      this.endedBySpace = true;
      this.endedAt = t;
      if (exact) this.wordsCorrect += 1;
      return;
    }
    if (exact) {
      this.leftCorrectChars += word.length + 1;
      this.wordsCorrect += 1;
    }
    this.current += 1;
  }

  private hasError(index: number): boolean {
    return this.typed[index]!.join("") !== this.words[index];
  }

  private backspace(typed: string[]): void {
    if (typed.length > 0) typed.pop();
    else if (this.current > 0 && this.hasError(this.current - 1)) this.stepBack();
  }

  private ctrlBackspace(typed: string[]): void {
    if (typed.length > 0) typed.length = 0;
    else if (this.current > 0 && this.hasError(this.current - 1)) {
      this.stepBack();
      this.typed[this.current]!.length = 0;
    }
  }

  /** Back into an erroneous word: it was never exact, so leaving it added nothing to the counts. */
  private stepBack(): void {
    this.current -= 1;
  }

  private letter(key: string, t: number, word: string, typed: string[]): void {
    if (typed.length >= word.length + this.rules.maxExtraLetters) return;
    const position = typed.length;
    typed.push(key);
    const correct = position < word.length && word[position] === key;
    this.keystrokes.push({ t, correct, miskeyed: correct ? null : position < word.length ? word.charAt(position) : "extra" });
    if (this.rules.timeLimitMs === null && this.current === this.words.length - 1 && typed.join("") === word) {
      this.finished = true;
      this.endedAt = t;
      this.wordsCorrect += 1;
    }
  }

  private isLeft(index: number): boolean {
    return index < this.current || (index === this.current && this.endedBySpace);
  }

  letterStates(index: number, blind: boolean): LetterState[] {
    const word = this.words[index]!;
    const typed = this.typed[index]!;
    const left = this.isLeft(index);
    const states: LetterState[] = [];
    for (let j = 0; j < word.length; j++) {
      if (j < typed.length) states.push(blind ? "typed" : typed[j] === word[j] ? "correct" : "incorrect");
      else states.push(left && !blind ? "missed" : "untyped");
    }
    if (!blind) for (let j = word.length; j < typed.length; j++) states.push("extra");
    return states;
  }

  /** Characters of correct words counted at this moment: words left exactly, plus the typed prefix of the current word. */
  liveSpeedChars(): number {
    const typed = this.typed[this.current]!.join("");
    return this.leftCorrectChars + (this.words[this.current]!.startsWith(typed) ? typed.length : 0);
  }

  /** Accuracy of the keystrokes so far; 100 with none. */
  get liveAccuracy(): Ratio {
    const correct = this.keystrokes.filter((strike) => strike.correct).length;
    return this.keystrokes.length === 0 ? { num: 100, den: 1 } : { num: 100 * correct, den: this.keystrokes.length };
  }

  private finalWordChars(): number {
    if (!this.finished || this.rules.timeLimitMs !== null) return this.liveSpeedChars();
    const typed = this.typed[this.current]!.join("");
    return this.leftCorrectChars + (typed === this.words[this.current] ? typed.length : 0);
  }

  private characterCounts(): Characters {
    let correct = 0;
    let incorrect = 0;
    let extra = 0;
    let missed = 0;
    for (let index = 0; index <= this.current; index++) {
      const word = this.words[index]!;
      const typed = this.typed[index]!;
      typed.forEach((letter, position) => {
        if (position >= word.length) extra += 1;
        else if (letter === word[position]) correct += 1;
        else incorrect += 1;
      });
      if (this.isLeft(index)) missed += Math.max(0, word.length - typed.length);
    }
    return { correct, incorrect, extra, missed };
  }

  /** The score of the log applied so far; null when a words, quote, custom or race test never ended. */
  score(secondSpeeds: readonly number[] | null = null): RunScore | null {
    const duration = this.rules.timeLimitMs ?? this.endedAt;
    if (duration === null) return null;
    const strikes = this.keystrokes;
    const wordChars = this.finalWordChars();
    const perSecond = secondRows(strikes, duration, wordChars, secondSpeeds);
    const raws = perSecond.map((row) => ratioValue(row.raw));
    const mean = raws.length === 0 ? 0 : raws.reduce((sum, value) => sum + value, 0) / raws.length;
    const deviation = raws.length === 0 ? 0 : Math.sqrt(raws.reduce((sum, value) => sum + (value - mean) ** 2, 0) / raws.length);
    const counts = new Map<string, number>();
    for (const strike of strikes) if (strike.miskeyed !== null) counts.set(strike.miskeyed, (counts.get(strike.miskeyed) ?? 0) + 1);
    return {
      duration,
      speed: duration === 0 ? ZERO : { num: wordChars * 12000, den: duration },
      raw: duration === 0 ? ZERO : { num: strikes.length * 12000, den: duration },
      accuracy: this.liveAccuracy,
      consistency: mean === 0 ? 0 : Math.max(0, 100 - (100 * deviation) / mean),
      characters: this.characterCounts(),
      perSecond,
      errorsByKey: [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    };
  }
}

const ZERO: Ratio = { num: 0, den: 1 };

function secondRows(strikes: readonly Keystroke[], duration: number, finalWordChars: number, secondSpeeds: readonly number[] | null): SecondRow[] {
  const seconds = Math.ceil(duration / 1000);
  const rows: SecondRow[] = [];
  for (let k = 1; k <= seconds; k++) {
    const from = (k - 1) * 1000;
    const to = Math.min(k * 1000, duration);
    const inside = strikes.filter((strike) => (strike.t >= from && strike.t < to) || (k === seconds && strike.t === duration));
    const speedChars = secondSpeeds?.[k - 1];
    rows.push({
      second: k,
      speed: k * 1000 >= duration ? { num: finalWordChars * 12000, den: duration } : { num: (speedChars ?? 0) * 12, den: k },
      raw: { num: inside.length * 12000, den: to - from },
      errors: inside.filter((strike) => !strike.correct).length,
    });
  }
  return rows;
}

interface Replay {
  readonly engine: TypingEngine;
  readonly score: RunScore | null;
  /** False when some entry came after the test ended or at or past a time test's limit. */
  readonly everyKeyTyped: boolean;
}

/** Applies a whole log, recording at each whole second the characters of correct words typed so far, for the per-second speed. */
export function replayLog(words: readonly string[], log: readonly LogEntry[], rules: EngineRules): Replay {
  const engine = new TypingEngine(words, rules);
  const snapshots: number[] = [];
  const ticks = rules.timeLimitMs === null ? Number.POSITIVE_INFINITY : Math.ceil(rules.timeLimitMs / 1000);
  let everyKeyTyped = true;
  for (const entry of log) {
    while (snapshots.length < ticks && (snapshots.length + 1) * 1000 <= entry.t) snapshots.push(engine.liveSpeedChars());
    everyKeyTyped = engine.apply(entry) && everyKeyTyped;
  }
  const duration = engine.score()?.duration ?? 0;
  while (snapshots.length * 1000 < duration) snapshots.push(engine.liveSpeedChars());
  return { engine, score: engine.score(snapshots), everyKeyTyped };
}

/** The rules a test of this mode and length is played under. */
export function rulesFor(mode: string, length: string | number | null, maxExtraLetters: number): EngineRules {
  return { timeLimitMs: mode === "time" ? Number(length) * 1000 : null, maxExtraLetters };
}

/** The live readouts at a whole second: speed and accuracy over the keystrokes typed before it. */
export function readoutAt(words: readonly string[], log: readonly LogEntry[], rules: EngineRules, second: number): { speed: Ratio; accuracy: Ratio } {
  const engine = new TypingEngine(words, rules);
  for (const entry of log) if (entry.t < second * 1000) engine.apply(entry);
  return { speed: { num: engine.liveSpeedChars() * 12, den: second }, accuracy: engine.liveAccuracy };
}
