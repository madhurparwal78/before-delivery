import { characters } from './text';

export const tagFilterMessages = {
  tooLong: 'Tag filters are limited to 256 characters.',
  unreadable: (position: number) => `Tag filter could not be read near character ${position}.`,
  tooManyComparisons: 'Tag filters are limited to 10 comparisons.',
  tooDeep: 'Tag filters are limited to 3 levels of parentheses.',
};

export class TagFilterError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

type Node =
  | { kind: 'comparison'; key: string; negated: boolean; value: string; prefix: boolean }
  | { kind: 'not'; inner: Node }
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'or'; left: Node; right: Node };

interface Token {
  type: 'open' | 'close' | 'and' | 'or' | 'not' | 'comparison';
  position: number;
  comparison?: { key: string; negated: boolean; value: string; prefix: boolean };
}

const bareKeyStop = new Set([' ', '\t', '(', ')', '=', '!', '"', '*']);
const bareValueStop = new Set([' ', '\t', '(', ')', '"', '*']);

function unreadable(position: number): never {
  throw new TagFilterError(tagFilterMessages.unreadable(position));
}

function tokenise(source: string[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const atEnd = () => index >= source.length;
  const peek = () => source[index];

  const readQuoted = (): string => {
    const openPosition = index + 1;
    index += 1;
    let out = '';
    while (!atEnd()) {
      const character = source[index];
      if (character === '\\') {
        const next = source[index + 1];
        if (next === '"' || next === '\\') {
          out += next;
          index += 2;
          continue;
        }
        out += character;
        index += 1;
        continue;
      }
      if (character === '"') {
        index += 1;
        return out;
      }
      out += character;
      index += 1;
    }
    unreadable(openPosition);
  };

  while (!atEnd()) {
    const character = peek();
    if (character === ' ' || character === '\t') {
      index += 1;
      continue;
    }
    const position = index + 1;
    if (character === '(') {
      tokens.push({ type: 'open', position });
      index += 1;
      continue;
    }
    if (character === ')') {
      tokens.push({ type: 'close', position });
      index += 1;
      continue;
    }
    const rest = source.slice(index).join('');
    const keyword = /^(and|or|not)(?=[\s()]|$)/.exec(rest);
    if (keyword) {
      tokens.push({ type: keyword[1] as 'and' | 'or' | 'not', position });
      index += keyword[1].length;
      continue;
    }
    const start = position;
    let key: string;
    if (character === '"') key = readQuoted();
    else {
      let bare = '';
      while (!atEnd() && !bareKeyStop.has(source[index])) {
        bare += source[index];
        index += 1;
      }
      if (bare === '') unreadable(start);
      key = bare;
    }
    let negated = false;
    if (!atEnd() && source[index] === '!') {
      if (source[index + 1] !== '=') unreadable(start);
      negated = true;
      index += 2;
    } else if (!atEnd() && source[index] === '=') {
      index += 1;
    } else unreadable(start);
    let value = '';
    let prefix = false;
    if (!atEnd() && source[index] === '"') value = readQuoted();
    else if (!atEnd() && source[index] === '*') {
      prefix = true;
      index += 1;
    } else {
      let bare = '';
      while (!atEnd() && !bareValueStop.has(source[index])) {
        bare += source[index];
        index += 1;
      }
      if (bare === '') unreadable(start);
      value = bare;
    }
    if (!prefix && !atEnd() && source[index] === '*') {
      prefix = true;
      index += 1;
    }
    if (!atEnd() && !([' ', '\t', '(', ')'] as string[]).includes(source[index])) {
      if (source[index] === '*') unreadable(index + 1);
      unreadable(start);
    }
    tokens.push({ type: 'comparison', position: start, comparison: { key, negated, value, prefix } });
  }
  return tokens;
}

interface ParseState {
  tokens: Token[];
  index: number;
  length: number;
  comparisons: number;
  depth: number;
  maxDepth: number;
}

function parseExpression(state: ParseState): Node {
  let left = parseTerm(state);
  while (state.index < state.tokens.length && state.tokens[state.index].type === 'or') {
    state.index += 1;
    const right = parseTerm(state);
    left = { kind: 'or', left, right };
  }
  return left;
}

function parseTerm(state: ParseState): Node {
  let left = parseUnary(state);
  while (state.index < state.tokens.length && state.tokens[state.index].type === 'and') {
    state.index += 1;
    const right = parseUnary(state);
    left = { kind: 'and', left, right };
  }
  return left;
}

function parseUnary(state: ParseState): Node {
  if (state.index >= state.tokens.length) unreadable(state.length + 1);
  const token = state.tokens[state.index];
  if (token.type === 'not') {
    state.index += 1;
    return { kind: 'not', inner: parseUnary(state) };
  }
  if (token.type === 'open') {
    state.index += 1;
    state.depth += 1;
    state.maxDepth = Math.max(state.maxDepth, state.depth);
    const inner = parseExpression(state);
    if (state.index >= state.tokens.length) unreadable(state.length + 1);
    if (state.tokens[state.index].type !== 'close') unreadable(state.tokens[state.index].position);
    state.index += 1;
    state.depth -= 1;
    return inner;
  }
  if (token.type === 'comparison' && token.comparison) {
    state.index += 1;
    state.comparisons += 1;
    return { kind: 'comparison', ...token.comparison };
  }
  unreadable(token.position);
}

export interface TagFilter {
  matches: (tags: Record<string, string>) => boolean;
}

/** The one tag-filter reader, with the published limits and error positions. */
export function parseTagFilter(source: string): TagFilter | null {
  const graphemes = characters(source);
  if (graphemes.length > 256) throw new TagFilterError(tagFilterMessages.tooLong);
  if (source.trim() === '') return null;
  const tokens = tokenise(graphemes);
  if (tokens.length === 0) return null;
  const state: ParseState = { tokens, index: 0, length: graphemes.length, comparisons: 0, depth: 0, maxDepth: 0 };
  const node = parseExpression(state);
  if (state.index < tokens.length) unreadable(tokens[state.index].position);
  if (state.comparisons > 10) throw new TagFilterError(tagFilterMessages.tooManyComparisons);
  if (state.maxDepth > 3) throw new TagFilterError(tagFilterMessages.tooDeep);
  return { matches: (tags) => evaluate(node, tags) };
}

function comparisonMatches(node: Extract<Node, { kind: 'comparison' }>, tags: Record<string, string>): boolean {
  if (!(node.key in tags)) return false;
  const value = tags[node.key];
  const hit = node.prefix ? value.startsWith(node.value) : value === node.value;
  return node.negated ? !hit : hit;
}

function evaluate(node: Node, tags: Record<string, string>): boolean {
  switch (node.kind) {
    case 'comparison':
      return comparisonMatches(node, tags);
    case 'not':
      return !evaluate(node.inner, tags);
    case 'and':
      return evaluate(node.left, tags) && evaluate(node.right, tags);
    case 'or':
      return evaluate(node.left, tags) || evaluate(node.right, tags);
  }
}
