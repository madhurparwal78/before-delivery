/**
 * The one typing engine. The test sheet, the carbon replay, the race page and the
 * server replay all score a keystroke log through this file.
 */

export type TestMode = 'time' | 'words' | 'quote' | 'custom';
export type TestKind = 'time' | 'finite';
export type LetterState = 'untyped' | 'correct' | 'incorrect' | 'extra' | 'missed';

export interface LogEntry {
  readonly k: string;
  readonly t: number;
}

export interface Characters {
  readonly correct: number;
  readonly incorrect: number;
  readonly extra: number;
  readonly missed: number;
}

export interface Keystroke {
  readonly t: number;
  readonly correct: boolean;
  /** The key the typist should have struck, `space` or `extra`; null when correct. */
  readonly errorKey: string | null;
}

export interface PerSecondRow {
  readonly second: number;
  readonly speed: number;
  readonly raw: number;
  readonly errors: number;
}

export interface EngineFigures {
  readonly duration: number;
  readonly speed: number;
  readonly raw: number;
  readonly accuracy: number;
  readonly consistency: number;
  readonly characters: Characters;
  readonly perSecond: PerSecondRow[];
  readonly errorsByKey: Record<string, number>;
}

export const SPACE = 'Space';
export const BACKSPACE = 'Backspace';
export const CTRL_BACKSPACE = 'CtrlBackspace';

export function isPrintedKey(key: string): boolean {
  return [...key].length === 1 && key >= ' ' && key !== '\u007f';
}

export function isAllowedLogKey(key: string): boolean {
  return key === SPACE || key === BACKSPACE || key === CTRL_BACKSPACE || isPrintedKey(key);
}

export function kindOfMode(mode: TestMode | 'race'): TestKind {
  return mode === 'time' ? 'time' : 'finite';
}

export interface WordState {
  readonly word: string;
  readonly typed: string[];
  /** The word was left with Space, so its untyped letters are missed. */
  left: boolean;
}

export interface ApplyResult {
  /** The entry changed the typed state. */
  readonly effect: boolean;
  readonly keystroke: Keystroke | null;
  readonly endedNow: boolean;
}

export class TypingEngine {
  readonly words: WordState[];
  readonly kind: TestKind;
  private readonly maxExtraLetters: number;
  private current = 0;
  private readonly strokes: Keystroke[] = [];
  private finished = false;
  private endTime: number | null = null;
  private afterEnd = 0;

  constructor(words: readonly string[], kind: TestKind, maxExtraLetters: number) {
    this.words = words.map((word) => ({ word, typed: [], left: false }));
    this.kind = kind;
    this.maxExtraLetters = maxExtraLetters;
  }

  get currentWord(): number {
    return this.current;
  }

  get caretLetters(): number {
    return this.wordAt(this.current).typed.length;
  }

  get keystrokes(): readonly Keystroke[] {
    return this.strokes;
  }

  get ended(): boolean {
    return this.finished;
  }

  /** The `t` of the keystroke that ended a finite test. */
  get endT(): number | null {
    return this.endTime;
  }

  /** Entries that arrived after the ending keystroke of a finite test. */
  get entriesAfterEnd(): number {
    return this.afterEnd;
  }

  private wordAt(index: number): WordState {
    const word = this.words[index];
    if (!word) throw new Error(`no word at ${index}`);
    return word;
  }

  private hasError(index: number): boolean {
    const state = this.wordAt(index);
    return state.typed.join('') !== state.word;
  }

  apply(entry: LogEntry): ApplyResult {
    if (this.finished) {
      this.afterEnd += 1;
      return { effect: false, keystroke: null, endedNow: false };
    }
    const result = this.dispatch(entry);
    if (result.keystroke) this.strokes.push(result.keystroke);
    if (result.endedNow) {
      this.finished = true;
      this.endTime = entry.t;
    }
    return result;
  }

  applyAll(log: readonly LogEntry[]): void {
    for (const entry of log) this.apply(entry);
  }

  private dispatch(entry: LogEntry): ApplyResult {
    if (entry.k === BACKSPACE) return this.backspace(false);
    if (entry.k === CTRL_BACKSPACE) return this.backspace(true);
    if (entry.k === SPACE) return this.space(entry.t);
    return this.letter(entry.k, entry.t);
  }

  private letter(key: string, t: number): ApplyResult {
    const state = this.wordAt(this.current);
    const position = state.typed.length;
    if (position < state.word.length) {
      state.typed.push(key);
      const expected = state.word.charAt(position);
      const correct = key === expected;
      const endedNow =
        this.kind === 'finite' &&
        this.current === this.words.length - 1 &&
        state.typed.join('') === state.word;
      return {
        effect: true,
        keystroke: { t, correct, errorKey: correct ? null : expected },
        endedNow,
      };
    }
    if (position - state.word.length < this.maxExtraLetters) {
      state.typed.push(key);
      return { effect: true, keystroke: { t, correct: false, errorKey: 'extra' }, endedNow: false };
    }
    return { effect: false, keystroke: null, endedNow: false };
  }

  private space(t: number): ApplyResult {
    const state = this.wordAt(this.current);
    const last = this.current === this.words.length - 1;
    if (state.typed.length === 0) return { effect: false, keystroke: null, endedNow: false };
    if (this.kind === 'time' && last) return { effect: false, keystroke: null, endedNow: false };
    const exact = state.typed.join('') === state.word;
    state.left = true;
    if (!last) this.current += 1;
    return {
      effect: true,
      keystroke: { t, correct: exact, errorKey: exact ? null : 'space' },
      endedNow: last,
    };
  }

  private backspace(whole: boolean): ApplyResult {
    const state = this.wordAt(this.current);
    if (state.typed.length > 0) {
      if (whole) state.typed.length = 0;
      else state.typed.pop();
      return { effect: true, keystroke: null, endedNow: false };
    }
    if (this.current > 0 && this.hasError(this.current - 1)) {
      this.current -= 1;
      const previous = this.wordAt(this.current);
      previous.left = false;
      if (whole) previous.typed.length = 0;
      return { effect: true, keystroke: null, endedNow: false };
    }
    return { effect: false, keystroke: null, endedNow: false };
  }

  letterStates(index: number): LetterState[] {
    const state = this.wordAt(index);
    const states: LetterState[] = [];
    for (let i = 0; i < state.word.length; i += 1) {
      const typed = state.typed[i];
      if (typed === undefined) states.push(state.left ? 'missed' : 'untyped');
      else states.push(typed === state.word.charAt(i) ? 'correct' : 'incorrect');
    }
    for (let i = state.word.length; i < state.typed.length; i += 1) states.push('extra');
    return states;
  }

  /** Letters typed into the word, including extras. */
  typedLetters(index: number): readonly string[] {
    return this.wordAt(index).typed;
  }

  characters(): Characters {
    let correct = 0;
    let incorrect = 0;
    let extra = 0;
    let missed = 0;
    for (let index = 0; index <= this.current; index += 1) {
      const state = this.wordAt(index);
      for (let i = 0; i < state.typed.length; i += 1) {
        if (i >= state.word.length) extra += 1;
        else if (state.typed[i] === state.word.charAt(i)) correct += 1;
        else incorrect += 1;
      }
      if (state.left && state.typed.length < state.word.length) {
        missed += state.word.length - state.typed.length;
      }
    }
    return { correct, incorrect, extra, missed };
  }

  /**
   * Characters of correctly typed words, the numerator of Speed.
   * `finalWordRule` is `exact` for a finished finite test and `prefix` when the last
   * word is still open, as in a time test and in every per-second score.
   */
  correctWordCharacters(finalWordRule: 'exact' | 'prefix'): number {
    let total = 0;
    for (let index = 0; index <= this.current; index += 1) {
      const state = this.wordAt(index);
      const typed = state.typed.join('');
      if (state.left) {
        if (typed === state.word) total += state.word.length + 1;
        continue;
      }
      if (index !== this.current) continue;
      if (finalWordRule === 'exact') {
        if (typed === state.word) total += state.word.length;
      } else if (state.word.startsWith(typed)) {
        total += state.typed.length;
      }
    }
    return total;
  }

  /** Words a racer has completed correctly, the numerator of race progress. */
  wordsCompletedCorrectly(): number {
    let total = 0;
    for (let index = 0; index <= this.current; index += 1) {
      const state = this.wordAt(index);
      if (state.left && state.typed.join('') === state.word) total += 1;
    }
    return total;
  }

  /** The index of the last word the run reached, for the carbon. */
  get reachedWords(): number {
    return this.current + 1;
  }
}

export function roundHalfUp(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  const scaled = Number((Math.abs(value) * factor).toFixed(6));
  const rounded = Math.round(scaled) / factor;
  return value < 0 ? -rounded : rounded;
}

export function speedFrom(correctWordCharacters: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return correctWordCharacters / 5 / (durationMs / 60000);
}

export function rawFrom(keystrokes: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return keystrokes / 5 / (durationMs / 60000);
}

export function accuracyFrom(strokes: readonly Keystroke[]): number {
  if (strokes.length === 0) return 100;
  const correct = strokes.filter((stroke) => stroke.correct).length;
  return (100 * correct) / strokes.length;
}

export function secondsInRun(durationMs: number): number {
  return Math.ceil(durationMs / 1000);
}

interface SecondInterval {
  readonly from: number;
  readonly to: number;
  readonly includeEnd: boolean;
}

function secondInterval(second: number, durationMs: number): SecondInterval {
  const from = (second - 1) * 1000;
  const to = Math.min(second * 1000, durationMs);
  return { from, to, includeEnd: second * 1000 >= durationMs };
}

function strokesInSecond(
  strokes: readonly Keystroke[],
  second: number,
  durationMs: number,
): Keystroke[] {
  const { from, to, includeEnd } = secondInterval(second, durationMs);
  return strokes.filter(
    (stroke) => stroke.t >= from && (stroke.t < to || (includeEnd && stroke.t === to)),
  );
}

export function perSecondRaw(
  strokes: readonly Keystroke[],
  second: number,
  durationMs: number,
): number {
  const { from, to } = secondInterval(second, durationMs);
  const length = to - from;
  if (length <= 0) return 0;
  return (strokesInSecond(strokes, second, durationMs).length * 12000) / length;
}

export function perSecondRawValues(
  strokes: readonly Keystroke[],
  durationMs: number,
): number[] {
  const values: number[] = [];
  for (let second = 1; second <= secondsInRun(durationMs); second += 1) {
    values.push(perSecondRaw(strokes, second, durationMs));
  }
  return values;
}

export function consistencyFrom(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.max(0, 100 - (100 * Math.sqrt(variance)) / mean);
}

export function errorsByKeyFrom(strokes: readonly Keystroke[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const stroke of strokes) {
    if (stroke.errorKey === null) continue;
    counts[stroke.errorKey] = (counts[stroke.errorKey] ?? 0) + 1;
  }
  return counts;
}

export function errorsByKeyOrder(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
}

export interface ReplayInput {
  readonly words: readonly string[];
  readonly kind: TestKind;
  readonly log: readonly LogEntry[];
  readonly maxExtraLetters: number;
  /** `<length> * 1000` for a time test; null for a finite test, whose duration is its end. */
  readonly timeDurationMs: number | null;
}

export interface ReplayResult {
  readonly engine: TypingEngine;
  readonly figures: EngineFigures;
}

/**
 * The Speed of the keystrokes before `second`, scored as a time test of that many seconds.
 * This is the live readout, the chart's Speed and the replay numeral.
 */
export function prefixSpeed(input: ReplayInput, second: number): number {
  const engine = new TypingEngine(input.words, input.kind, input.maxExtraLetters);
  for (const entry of input.log) {
    if (entry.t >= second * 1000) break;
    engine.apply(entry);
  }
  return speedFrom(engine.correctWordCharacters('prefix'), second * 1000);
}

export function replay(input: ReplayInput): ReplayResult {
  const engine = new TypingEngine(input.words, input.kind, input.maxExtraLetters);
  engine.applyAll(input.log);
  const duration =
    input.timeDurationMs !== null ? input.timeDurationMs : engine.endT !== null ? engine.endT : 0;
  const strokes = engine.keystrokes;
  const speed = speedFrom(
    engine.correctWordCharacters(input.kind === 'finite' && engine.ended ? 'exact' : 'prefix'),
    duration,
  );
  const raw = rawFrom(strokes.length, duration);
  const accuracy = accuracyFrom(strokes);
  const rawValues = perSecondRawValues(strokes, duration);
  const consistency = duration <= 0 ? 0 : consistencyFrom(rawValues);
  const perSecond: PerSecondRow[] = [];
  for (let second = 1; second <= secondsInRun(duration); second += 1) {
    perSecond.push({
      second,
      speed: second * 1000 >= duration ? speed : prefixSpeed(input, second),
      raw: rawValues[second - 1] ?? 0,
      errors: strokesInSecond(strokes, second, duration).filter((stroke) => !stroke.correct).length,
    });
  }
  return {
    engine,
    figures: {
      duration,
      speed,
      raw,
      accuracy,
      consistency,
      characters: engine.characters(),
      perSecond,
      errorsByKey: errorsByKeyFrom(strokes),
    },
  };
}
