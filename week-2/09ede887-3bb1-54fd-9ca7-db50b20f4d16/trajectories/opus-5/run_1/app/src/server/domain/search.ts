import { fold } from './fold.js';

/**
 * The published query grammar for session search:
 *
 *   query   = or
 *   or      = and ( "OR" and )*
 *   and     = unary ( [ "AND" ] unary )*
 *   unary   = "-" unary | primary
 *   primary = term | phrase | "(" or ")"
 */

type Token =
  | { readonly type: 'term'; readonly text: string }
  | { readonly type: 'phrase'; readonly text: string }
  | { readonly type: 'lparen' }
  | { readonly type: 'rparen' }
  | { readonly type: 'and' }
  | { readonly type: 'or' }
  | { readonly type: 'neg' };

export type Query =
  | { readonly kind: 'all' }
  | { readonly kind: 'match'; readonly needle: string }
  | { readonly kind: 'not'; readonly operand: Query }
  | { readonly kind: 'and'; readonly operands: readonly Query[] }
  | { readonly kind: 'or'; readonly operands: readonly Query[] };

const TERM_STOP = new Set([' ', '\t', '\n', '\r', '\f', '\v', '(', ')', '"']);

function isSpace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const character = input[index] as string;
    if (isSpace(character)) {
      index += 1;
      continue;
    }
    let negations = 0;
    while (input[index] === '-') {
      negations += 1;
      index += 1;
    }
    const head = input[index];
    if (negations > 0 && (head === undefined || isSpace(head) || head === ')')) {
      // A `-` that negates nothing; dropped by the recovery rules.
      continue;
    }
    for (let count = 0; count < negations; count += 1) tokens.push({ type: 'neg' });
    if (head === undefined) continue;
    if (head === '(') {
      tokens.push({ type: 'lparen' });
      index += 1;
      continue;
    }
    if (head === ')') {
      tokens.push({ type: 'rparen' });
      index += 1;
      continue;
    }
    if (head === '"') {
      index += 1;
      let text = '';
      while (index < input.length) {
        const inner = input[index] as string;
        if (inner === '"') {
          index += 1;
          break;
        }
        if (inner === '\\') {
          const next = input[index + 1];
          if (next === '"' || next === '\\') {
            text += next;
            index += 2;
            continue;
          }
          text += '\\';
          index += 1;
          continue;
        }
        text += inner;
        index += 1;
      }
      tokens.push({ type: 'phrase', text });
      continue;
    }
    let text = '';
    while (index < input.length && !TERM_STOP.has(input[index] as string)) {
      text += input[index];
      index += 1;
    }
    if (negations === 0 && text === 'AND') tokens.push({ type: 'and' });
    else if (negations === 0 && text === 'OR') tokens.push({ type: 'or' });
    else tokens.push({ type: 'term', text });
  }
  return tokens;
}

/** Recovery rules 2 and 3: close every open group, drop every stray `)`. */
function balanceGroups(tokens: readonly Token[]): Token[] {
  const balanced: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.type === 'rparen') {
      if (depth === 0) continue;
      depth -= 1;
    } else if (token.type === 'lparen') {
      depth += 1;
    }
    balanced.push(token);
  }
  for (let count = 0; count < depth; count += 1) balanced.push({ type: 'rparen' });
  return balanced;
}

function dropPrecedingNegations(tokens: Token[], from: number): number {
  let start = from;
  while (start > 0 && (tokens[start - 1] as Token).type === 'neg') start -= 1;
  return start;
}

/** Recovery rule 4: drop empty phrases, empty groups and negations of nothing. */
function dropEmpty(tokens: readonly Token[]): Token[] {
  let current = [...tokens];
  for (;;) {
    let changed = false;
    for (let index = 0; index < current.length; index += 1) {
      const token = current[index] as Token;
      const isEmptyPhrase = token.type === 'phrase' && token.text === '';
      const isEmptyGroup = token.type === 'lparen' && (current[index + 1] as Token | undefined)?.type === 'rparen';
      if (!isEmptyPhrase && !isEmptyGroup) continue;
      const start = dropPrecedingNegations(current, index);
      current.splice(start, (isEmptyGroup ? 2 : 1) + (index - start));
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return current.filter((token, index) => {
    if (token.type !== 'neg') return true;
    for (let scan = index + 1; scan < current.length; scan += 1) {
      const next = current[scan] as Token;
      if (next.type === 'neg') continue;
      return next.type === 'term' || next.type === 'phrase' || next.type === 'lparen';
    }
    return false;
  });
}

/** Recovery rule 5: drop misplaced operators and all but the last of a run. */
function fixOperators(tokens: readonly Token[]): Token[] {
  let current = [...tokens];
  for (;;) {
    const next = current.filter((token, index) => {
      if (token.type !== 'and' && token.type !== 'or') return true;
      const following = current[index + 1];
      if (following !== undefined && (following.type === 'and' || following.type === 'or')) return false;
      const previous = current[index - 1];
      if (previous === undefined || previous.type === 'lparen') return false;
      if (following === undefined || following.type === 'rparen') return false;
      return true;
    });
    if (next.length === current.length) return current;
    current = next;
  }
}

/** Removes a group that wraps nothing but another group, keeping recursion shallow. */
function flattenGroups(tokens: readonly Token[]): Token[] {
  const match = new Map<number, number>();
  const open: number[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'lparen') open.push(index);
    else if (token.type === 'rparen') {
      const start = open.pop();
      if (start !== undefined) match.set(start, index);
    }
  }
  const dropped = new Set<number>();
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'lparen') continue;
    const inner = tokens[index + 1];
    if (inner === undefined || inner.type !== 'lparen') continue;
    const outerEnd = match.get(index);
    const innerEnd = match.get(index + 1);
    if (outerEnd === undefined || innerEnd === undefined || innerEnd !== outerEnd - 1) continue;
    dropped.add(index);
    dropped.add(outerEnd);
  }
  return tokens.filter((_token, index) => !dropped.has(index));
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Query {
    const query = this.parseOr();
    return query;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private parseOr(): Query {
    const operands: Query[] = [this.parseAnd()];
    while (this.peek()?.type === 'or') {
      this.index += 1;
      operands.push(this.parseAnd());
    }
    return operands.length === 1 ? (operands[0] as Query) : { kind: 'or', operands };
  }

  private parseAnd(): Query {
    const operands: Query[] = [this.parseUnary()];
    for (;;) {
      const token = this.peek();
      if (token === undefined) break;
      if (token.type === 'and') {
        this.index += 1;
        operands.push(this.parseUnary());
        continue;
      }
      if (token.type === 'term' || token.type === 'phrase' || token.type === 'lparen' || token.type === 'neg') {
        operands.push(this.parseUnary());
        continue;
      }
      break;
    }
    return operands.length === 1 ? (operands[0] as Query) : { kind: 'and', operands };
  }

  private parseUnary(): Query {
    if (this.peek()?.type === 'neg') {
      this.index += 1;
      return { kind: 'not', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Query {
    const token = this.peek();
    if (token === undefined) return { kind: 'all' };
    if (token.type === 'term' || token.type === 'phrase') {
      this.index += 1;
      return { kind: 'match', needle: fold(token.text) };
    }
    if (token.type === 'lparen') {
      this.index += 1;
      const inner = this.parseOr();
      if (this.peek()?.type === 'rparen') this.index += 1;
      return inner;
    }
    this.index += 1;
    return { kind: 'all' };
  }
}

export function parseQuery(raw: string): Query {
  const tokens = flattenGroups(fixOperators(dropEmpty(balanceGroups(tokenize(raw)))));
  if (tokens.length === 0) return { kind: 'all' };
  return new Parser(tokens).parse();
}

/** The folded fields a term or phrase may match: title, speaker names, companies. */
export function matchesQuery(query: Query, foldedFields: readonly string[]): boolean {
  switch (query.kind) {
    case 'all':
      return true;
    case 'match':
      return foldedFields.some((field) => field.includes(query.needle));
    case 'not':
      return !matchesQuery(query.operand, foldedFields);
    case 'and':
      return query.operands.every((operand) => matchesQuery(operand, foldedFields));
    case 'or':
      return query.operands.some((operand) => matchesQuery(operand, foldedFields));
  }
}
