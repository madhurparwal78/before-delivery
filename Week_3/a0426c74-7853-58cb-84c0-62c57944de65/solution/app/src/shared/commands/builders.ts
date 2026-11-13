// The three kinds of stage that most commands are made of.
import type { Point } from '../types.ts';
import type { CommandEnv } from './env.ts';
import { readOrDefault, readPoint, type Reading } from './points.ts';
import { isEnter, stay, type Entry, type Stage, type Step } from './stages.ts';

/** A point stage. A valid point is always recorded as the last point, whatever `then` makes of it. */
export function pointStage(prompt: string, then: (point: Point, env: CommandEnv) => Step, preview?: Stage['preview']): Stage {
  return {
    prompt,
    expects: 'point',
    accept(entry, env, last) {
      const point = readPoint(entry, last);
      return point.ok ? { ...then(point.value, env), point: point.value } : stay(point.message);
    },
    preview,
  };
}

/** A number stage; with a `fallback` an empty Enter gives it. */
export function numberStage(
  prompt: string, read: (entry: Entry) => Reading<number>, then: (value: number, env: CommandEnv) => Step, fallback?: number,
): Stage {
  return {
    prompt,
    expects: 'number',
    accept(entry, env) {
      const value = fallback === undefined ? read(entry) : readOrDefault(entry, fallback, read);
      return value.ok ? then(value.value, env) : stay(value.message);
    },
  };
}

/** A name, expression or text stage: Space is a character. An empty Enter gives `then` an empty string. */
export function textStage(prompt: string, then: (text: string, env: CommandEnv) => Step): Stage {
  return { prompt, expects: 'text', accept: (entry, env) => then(entry.kind === 'text' ? entry.text : '', env) };
}

/** A stage that waits for one of a few typed words (case ignored); an empty Enter is the word `onEnter`, when there is one. */
export function wordStage(prompt: string, words: Readonly<Record<string, (env: CommandEnv) => Step>>, onEnter?: string): Stage {
  return {
    prompt,
    expects: 'word',
    accept(entry, env) {
      const typed = entry.kind === 'text' ? entry.text.toUpperCase() : '';
      const word = isEnter(entry) && onEnter !== undefined ? onEnter : typed;
      const chosen = words[word];
      return chosen ? chosen(env) : stay();
    },
  };
}
