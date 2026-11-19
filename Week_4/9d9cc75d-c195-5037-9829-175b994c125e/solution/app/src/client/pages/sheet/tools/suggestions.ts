import { FUNCTIONS } from './functions.ts';

export interface Typed {
  /** index of the first typed character (the `[` in bracket mode) */
  start: number;
  /** what was typed after the `[`, or the word itself */
  prefix: string;
  /** after a `[`: only fields are offered */
  bracket: boolean;
}

export interface Suggestion {
  name: string;
  kind: 'function' | 'field';
}

/** The word or `[...` fragment that ends at the caret, or null when the caret does not follow one. */
export function typedAt(text: string, caret: number): Typed | null {
  const before = text.slice(0, caret);
  const bracket = /\[[^[\]\n]*$/.exec(before);
  if (bracket) return { start: bracket.index, prefix: bracket[0].slice(1), bracket: true };
  const word = /(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*$/.exec(before);
  return word ? { start: word.index, prefix: word[0], bracket: false } : null;
}

function alphabetical(names: readonly string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'en') || (a < b ? -1 : 1));
}

/** Names that start with what was typed, ignoring case: functions first, then fields, each alphabetical. */
export function suggest(typed: Typed, fieldNames: readonly string[]): Suggestion[] {
  const lead = typed.prefix.toLowerCase();
  const starts = (name: string) => name.toLowerCase().startsWith(lead);
  const functions = typed.bracket ? [] : alphabetical(FUNCTIONS).filter(starts);
  return [
    ...functions.map((name): Suggestion => ({ name, kind: 'function' })),
    ...alphabetical(fieldNames).filter(starts).map((name): Suggestion => ({ name, kind: 'field' })),
  ];
}

/** Replaces the typed text with `NAME(` or `[Name]` and puts the caret just after it. */
export function insert(text: string, caret: number, typed: Typed, choice: Suggestion): { text: string; caret: number } {
  const added = choice.kind === 'function' ? `${choice.name}(` : `[${choice.name}]`;
  const rest = text.slice(caret);
  const tail = typed.bracket && rest.startsWith(']') ? rest.slice(1) : rest;
  return { text: text.slice(0, typed.start) + added + tail, caret: typed.start + added.length };
}
