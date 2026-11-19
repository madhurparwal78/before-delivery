/**
 * Filter text: the published subset of the expression language used by lists,
 * saved filters, drill-downs and exports. This is the one place the subset's
 * grammar and its canonical form are decided, so the builder, the text and a
 * rebuilt builder always agree.
 */

import { filterTooComplex } from '../errors';
import { tokenize, type Token } from './lexer';

export type FilterOperator =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'contains'
  | 'startswith'
  | 'in'
  | 'is_empty'
  | 'not_is_empty';

export const filterOperators: readonly FilterOperator[] = [
  '=',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'contains',
  'startswith',
  'in',
  'is_empty',
  'not_is_empty',
];

/** `me()` is the one call the subset allows as a value. */
export const meCall = Symbol('me()');

export type FilterValue = null | boolean | number | string | typeof meCall | readonly FilterValue[];

export type Connector = 'and' | 'or';

export interface FilterCondition {
  readonly path: string;
  readonly op: FilterOperator;
  readonly value: FilterValue;
}

export interface FilterGroup {
  readonly connector: Connector;
  readonly conditions: readonly FilterCondition[];
}

export interface FilterBuilder {
  readonly connector: Connector;
  readonly groups: readonly FilterGroup[];
}

export const emptyBuilder: FilterBuilder = { connector: 'and', groups: [] };

const comparisonTexts = new Set(['=', '!=', '<', '<=', '>', '>=']);
const wordOperators = new Set(['contains', 'startswith', 'in']);

class FilterReader {
  private at = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.at];
  }

  private next(): Token {
    return this.tokens[this.at++];
  }

  private atPunct(text: string): boolean {
    const t = this.peek();
    return t.kind === 'punct' && t.text === text;
  }

  private atWord(word: string): boolean {
    const t = this.peek();
    return t.kind === 'ident' && t.text === word;
  }

  private atConnector(): Connector | null {
    if (this.atWord('and')) return 'and';
    if (this.atWord('or')) return 'or';
    return null;
  }

  read(): FilterBuilder {
    if (this.peek().kind === 'eof') return emptyBuilder;
    const groups: FilterGroup[] = [];
    const connectors: Connector[] = [];
    groups.push(this.readGroup());
    for (;;) {
      const connector = this.atConnector();
      if (!connector) break;
      this.next();
      connectors.push(connector);
      groups.push(this.readGroup());
    }
    if (this.peek().kind !== 'eof') throw filterTooComplex();
    return { connector: oneConnector(connectors), groups };
  }

  private readGroup(): FilterGroup {
    if (this.atPunct('(')) {
      this.next();
      const conditions: FilterCondition[] = [this.readCondition()];
      const connectors: Connector[] = [];
      for (;;) {
        const connector = this.atConnector();
        if (!connector) break;
        this.next();
        connectors.push(connector);
        conditions.push(this.readCondition());
      }
      if (!this.atPunct(')')) throw filterTooComplex();
      this.next();
      return { connector: oneConnector(connectors), conditions };
    }
    return { connector: 'and', conditions: [this.readCondition()] };
  }

  private readCondition(): FilterCondition {
    if (this.atWord('not')) {
      this.next();
      if (!this.atWord('is_empty')) throw filterTooComplex();
      return { path: this.readEmptyCall(), op: 'not_is_empty', value: null };
    }
    if (this.atWord('is_empty')) {
      return { path: this.readEmptyCall(), op: 'is_empty', value: null };
    }
    const path = this.readPath();
    const opToken = this.peek();
    let op: FilterOperator;
    if (opToken.kind === 'punct' && comparisonTexts.has(opToken.text)) {
      op = opToken.text as FilterOperator;
    } else if (opToken.kind === 'ident' && wordOperators.has(opToken.text)) {
      op = opToken.text as FilterOperator;
    } else {
      throw filterTooComplex();
    }
    this.next();
    return { path, op, value: this.readValue() };
  }

  private readEmptyCall(): string {
    this.next(); // is_empty
    if (!this.atPunct('(')) throw filterTooComplex();
    this.next();
    const path = this.readPath();
    if (!this.atPunct(')')) throw filterTooComplex();
    this.next();
    return path;
  }

  private readPath(): string {
    const first = this.peek();
    if (first.kind !== 'ident' || isReservedWord(first.text)) throw filterTooComplex();
    this.next();
    const parts = [first.text];
    while (this.atPunct('.')) {
      this.next();
      const part = this.peek();
      if (part.kind !== 'ident') throw filterTooComplex();
      this.next();
      parts.push(part.text);
    }
    return parts.join('.');
  }

  private readValue(): FilterValue {
    const t = this.peek();
    if (t.kind === 'number') {
      this.next();
      return t.value as number;
    }
    if (t.kind === 'string') {
      this.next();
      return t.value as string;
    }
    if (t.kind === 'punct' && t.text === '-') {
      this.next();
      const n = this.peek();
      if (n.kind !== 'number') throw filterTooComplex();
      this.next();
      return -(n.value as number);
    }
    if (t.kind === 'punct' && t.text === '[') {
      this.next();
      const items: FilterValue[] = [];
      if (!this.atPunct(']')) {
        for (;;) {
          items.push(this.readScalar());
          if (this.atPunct(',')) {
            this.next();
            continue;
          }
          break;
        }
      }
      if (!this.atPunct(']')) throw filterTooComplex();
      this.next();
      return items;
    }
    if (t.kind === 'ident') {
      if (t.text === 'true' || t.text === 'false') {
        this.next();
        return t.text === 'true';
      }
      if (t.text === 'null') {
        this.next();
        return null;
      }
      if (t.text === 'me') {
        this.next();
        if (!this.atPunct('(')) throw filterTooComplex();
        this.next();
        if (!this.atPunct(')')) throw filterTooComplex();
        this.next();
        return meCall;
      }
    }
    throw filterTooComplex();
  }

  private readScalar(): FilterValue {
    const value = this.readValue();
    if (Array.isArray(value)) throw filterTooComplex();
    return value;
  }
}

function isReservedWord(word: string): boolean {
  return ['and', 'or', 'not', 'in', 'contains', 'startswith', 'true', 'false', 'null'].includes(word);
}

/** A connector with nothing to join is normalised to `and`. */
function oneConnector(connectors: readonly Connector[]): Connector {
  if (connectors.length === 0) return 'and';
  const first = connectors[0];
  if (connectors.some((c) => c !== first)) throw filterTooComplex();
  return first;
}

export function parseFilter(text: string): FilterBuilder {
  const trimmed = text.trim();
  if (trimmed === '') return emptyBuilder;
  let tokens: Token[];
  try {
    tokens = tokenize(trimmed);
  } catch {
    throw filterTooComplex();
  }
  return new FilterReader(tokens).read();
}

/** Numbers are written without a plus sign or leading zeros, fractional only when needed. */
export function writeNumber(n: number): string {
  if (!Number.isFinite(n)) throw filterTooComplex();
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

export function writeValue(value: FilterValue): string {
  if (value === meCall) return 'me()';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return writeNumber(value);
  if (typeof value === 'string') return JSON.stringify(value);
  return `[${value.map(writeValue).join(', ')}]`;
}

export function writeCondition(condition: FilterCondition): string {
  if (condition.op === 'is_empty') return `is_empty(${condition.path})`;
  if (condition.op === 'not_is_empty') return `not is_empty(${condition.path})`;
  return `${condition.path} ${condition.op} ${writeValue(condition.value)}`;
}

/**
 * Canonical filter text. A lone condition stands bare; any group holding more
 * than one condition, and every group once there are two or more, sits in
 * parentheses, so reading the text back gives this very builder.
 */
export function composeFilter(builder: FilterBuilder): string {
  const groups = builder.groups.filter((g) => g.conditions.length > 0);
  if (groups.length === 0) return '';
  if (groups.length === 1) {
    const group = groups[0];
    const inner = group.conditions.map(writeCondition).join(` ${group.conditions.length > 1 ? group.connector : 'and'} `);
    return group.conditions.length === 1 ? inner : `(${inner})`;
  }
  const parts = groups.map((group) => {
    const connector = group.conditions.length > 1 ? group.connector : 'and';
    return `(${group.conditions.map(writeCondition).join(` ${connector} `)})`;
  });
  return parts.join(` ${builder.connector} `);
}

/** Normalises a builder the way parsing and composing both do. */
export function normaliseBuilder(builder: FilterBuilder): FilterBuilder {
  const groups = builder.groups
    .filter((g) => g.conditions.length > 0)
    .map((g) => ({ connector: g.conditions.length > 1 ? g.connector : ('and' as Connector), conditions: g.conditions }));
  return { connector: groups.length > 1 ? builder.connector : 'and', groups };
}

export function canonicalFilter(text: string): string {
  return composeFilter(parseFilter(text));
}

/** Joins two filter texts so both must hold, used for drill-downs and queues. */
export function andFilters(left: string, right: string): string {
  const a = left.trim();
  const b = right.trim();
  if (a === '') return canonicalFilter(b);
  if (b === '') return canonicalFilter(a);
  const groupsOf = (text: string): readonly FilterGroup[] => {
    const builder = parseFilter(text);
    if (builder.connector === 'or' && builder.groups.length > 1) {
      // An or at the top becomes one parenthesised group so the and still binds.
      return [{ connector: 'or', conditions: builder.groups.flatMap((g) => g.conditions) }];
    }
    return builder.groups;
  };
  return composeFilter({ connector: 'and', groups: [...groupsOf(a), ...groupsOf(b)] });
}

export function builderPaths(builder: FilterBuilder): string[] {
  return builder.groups.flatMap((g) => g.conditions.map((c) => c.path));
}
