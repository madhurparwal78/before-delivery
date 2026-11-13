import { settings } from '../env.js';
import { fail } from '../errors.js';
import { analyze } from './analyze.js';
import type { FieldType } from './mapping.js';
import { isIsoDateString } from './mapping.js';

export type QueryNode =
  | { kind: 'and'; children: QueryNode[] }
  | { kind: 'or'; children: QueryNode[] }
  | { kind: 'not'; child: QueryNode }
  | { kind: 'term'; field: string; type: FieldType; value: string | number | boolean }
  | { kind: 'phrase'; field: string; tokens: string[]; slots: number[]; text: string }
  | { kind: 'exists'; field: string }
  | { kind: 'range'; field: string; type: FieldType; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { kind: 'wildcard'; field: string; type: FieldType; pattern: string }
  | { kind: 'scope'; field: string; child: QueryNode };

export type FieldLookup = {
  typeOf: (field: string) => FieldType | undefined;
  hasObject: (field: string) => boolean;
};

const ESCAPABLE = new Set([':', '(', ')', '{', '}', '"', '*', '\\']);
const KEYWORDS = new Set(['AND', 'OR', 'NOT']);

/** Rule F limits, checked in order before any matching. */
export function checkQueryLimits(text: string): void {
  const chars = Array.from(text);
  if (chars.length > settings.queryMaxLen) throw fail.queryTooLong();
  let depth = 0;
  let deepest = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '"') {
      index += 1;
      while (index < chars.length && chars[index] !== '"') {
        if (chars[index] === '\\') index += 1;
        index += 1;
      }
      continue;
    }
    if (char === '(' || char === '{') {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (char === ')' || char === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  if (deepest > settings.queryMaxDepth) throw fail.queryTooDeep();
}

type ReadValue = { text: string; start: number; quoted: boolean; starRunes: number[] };

class Parser {
  private readonly chars: string[];
  private index = 0;

  constructor(
    text: string,
    private readonly lookup: FieldLookup,
    private readonly nowMs: number,
  ) {
    this.chars = Array.from(text);
  }

  private error(message: string, position: number): never {
    throw fail.querySyntax(message, position);
  }

  private peek(): string | undefined {
    return this.chars[this.index];
  }

  private atEnd(): boolean {
    return this.index >= this.chars.length;
  }

  private skipSpaces(): void {
    while (!this.atEnd() && /\s/.test(this.chars[this.index])) this.index += 1;
  }

  private peekKeyword(): string | null {
    const save = this.index;
    this.skipSpaces();
    let word = '';
    let cursor = this.index;
    while (cursor < this.chars.length && /[A-Za-z]/.test(this.chars[cursor])) {
      word += this.chars[cursor];
      cursor += 1;
    }
    const next = this.chars[cursor];
    this.index = save;
    if (!KEYWORDS.has(word)) return null;
    if (next !== undefined && !/[\s()}]/.test(next)) return null;
    return word;
  }

  private takeKeyword(): void {
    this.skipSpaces();
    while (!this.atEnd() && /[A-Za-z]/.test(this.chars[this.index])) this.index += 1;
  }

  parse(): QueryNode {
    const node = this.parseOr();
    this.skipSpaces();
    if (!this.atEnd()) {
      if (this.peek() === ')' || this.peek() === '}') {
        this.error(`Expected a value at position ${this.index + 1}.`, this.index + 1);
      }
      this.error(`Expected AND or OR at position ${this.index + 1}.`, this.index + 1);
    }
    return node;
  }

  parseOr(): QueryNode {
    const children = [this.parseAnd()];
    for (;;) {
      if (this.peekKeyword() !== 'OR') break;
      this.takeKeyword();
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  }

  private parseAnd(): QueryNode {
    const children = [this.parseNot()];
    for (;;) {
      this.skipSpaces();
      if (this.atEnd() || this.peek() === ')' || this.peek() === '}') break;
      const keyword = this.peekKeyword();
      if (keyword === 'OR') break;
      if (keyword === 'AND') {
        this.takeKeyword();
        children.push(this.parseNot());
        continue;
      }
      if (keyword === 'NOT') {
        this.error(`Expected AND or OR at position ${this.index + 1}.`, this.index + 1);
      }
      this.error(`Expected AND or OR at position ${this.index + 1}.`, this.index + 1);
    }
    return children.length === 1 ? children[0] : { kind: 'and', children };
  }

  private parseNot(): QueryNode {
    this.skipSpaces();
    if (this.peekKeyword() === 'NOT') {
      this.takeKeyword();
      return { kind: 'not', child: this.parseNot() };
    }
    return this.parsePrimary('');
  }

  private parsePrimary(scope: string): QueryNode {
    this.skipSpaces();
    if (this.atEnd()) {
      this.error(`Expected a value at position ${this.chars.length + 1}.`, this.chars.length + 1);
    }
    if (this.peek() === '(') {
      const open = this.index;
      this.index += 1;
      const node = this.parseScopedOr(scope);
      this.skipSpaces();
      if (this.peek() !== ')') {
        this.error(`Unclosed parenthesis at position ${open + 1}.`, open + 1);
      }
      this.index += 1;
      return node;
    }
    if (this.peek() === '"') {
      const value = this.readValue();
      return this.buildLeaf(scope, 'message', 1, ':', value, 1);
    }
    const nameStart = this.index;
    const nameRead = this.readName();
    const name = nameRead.text;
    if (name === '') {
      this.error(`Expected a value at position ${this.index + 1}.`, this.index + 1);
    }
    if (this.peek() === '{') {
      const open = this.index;
      this.index += 1;
      const inner = scope === '' ? name : `${scope}.${name}`;
      this.requireField(inner, nameStart + 1, true);
      const child = this.parseScopedOr(inner);
      this.skipSpaces();
      if (this.peek() !== '}') {
        this.error(`Unclosed parenthesis at position ${open + 1}.`, open + 1);
      }
      this.index += 1;
      return { kind: 'scope', field: inner, child };
    }
    const operator = this.readOperator();
    if (operator === null) {
      return this.buildBare(scope, nameRead, nameStart + 1);
    }
    const operatorPosition = this.index - operator.length;
    this.skipSpaces();
    if (operator === ':' && this.peek() === '(') {
      return this.parseGroupedValues(scope, name, nameStart + 1);
    }
    if (operator === ':' && this.peek() === '*' && this.valueEndsAt(this.index + 1)) {
      this.index += 1;
      const field = scope === '' ? name : `${scope}.${name}`;
      this.requireField(field, nameStart + 1, false);
      return { kind: 'exists', field };
    }
    const value = this.readValueAfterOperator();
    return this.buildLeaf(scope, name, nameStart + 1, operator, value, operatorPosition + 1);
  }

  private parseScopedOr(scope: string): QueryNode {
    const children = [this.parseScopedAnd(scope)];
    for (;;) {
      if (this.peekKeyword() !== 'OR') break;
      this.takeKeyword();
      children.push(this.parseScopedAnd(scope));
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  }

  private parseScopedAnd(scope: string): QueryNode {
    const children = [this.parseScopedNot(scope)];
    for (;;) {
      this.skipSpaces();
      if (this.atEnd() || this.peek() === ')' || this.peek() === '}') break;
      const keyword = this.peekKeyword();
      if (keyword === 'OR') break;
      if (keyword === 'AND') {
        this.takeKeyword();
        children.push(this.parseScopedNot(scope));
        continue;
      }
      this.error(`Expected AND or OR at position ${this.index + 1}.`, this.index + 1);
    }
    return children.length === 1 ? children[0] : { kind: 'and', children };
  }

  private parseScopedNot(scope: string): QueryNode {
    this.skipSpaces();
    if (this.peekKeyword() === 'NOT') {
      this.takeKeyword();
      return { kind: 'not', child: this.parseScopedNot(scope) };
    }
    return this.parsePrimary(scope);
  }

  private parseGroupedValues(scope: string, name: string, namePosition: number): QueryNode {
    const open = this.index;
    this.index += 1;
    const children: QueryNode[] = [];
    let combine: 'or' | 'and' = 'or';
    for (;;) {
      this.skipSpaces();
      if (this.atEnd()) {
        this.error(`Unclosed parenthesis at position ${open + 1}.`, open + 1);
      }
      if (this.peek() === ')') {
        this.index += 1;
        break;
      }
      const keyword = this.peekKeyword();
      if (keyword === 'OR' || keyword === 'AND') {
        combine = keyword === 'OR' ? 'or' : 'and';
        this.takeKeyword();
        continue;
      }
      const value = this.readValue();
      children.push(this.buildLeaf(scope, name, namePosition, ':', value, value.start + 1));
    }
    if (children.length === 0) {
      this.error(`Expected a value at position ${open + 2}.`, open + 2);
    }
    return children.length === 1 ? children[0] : { kind: combine, children };
  }

  private valueEndsAt(position: number): boolean {
    const char = this.chars[position];
    return char === undefined || /[\s)}]/.test(char);
  }

  private readName(): ReadValue {
    const start = this.index;
    const starRunes: number[] = [];
    let name = '';
    while (!this.atEnd()) {
      const char = this.chars[this.index];
      if (char === '\\') {
        const next = this.chars[this.index + 1];
        if (next !== undefined && ESCAPABLE.has(next)) {
          name += next;
          this.index += 2;
          continue;
        }
      }
      if (/[\s:<>(){}"]/.test(char)) break;
      if (char === '*') starRunes.push(this.index);
      name += char;
      this.index += 1;
    }
    return { text: name, start, quoted: false, starRunes };
  }

  private readOperator(): ':' | '>' | '>=' | '<' | '<=' | null {
    const char = this.peek();
    if (char === ':') {
      this.index += 1;
      return ':';
    }
    if (char === '>' || char === '<') {
      this.index += 1;
      if (this.peek() === '=') {
        this.index += 1;
        return char === '>' ? '>=' : '<=';
      }
      return char;
    }
    return null;
  }

  private readValueAfterOperator(): ReadValue {
    this.skipSpaces();
    if (this.atEnd()) {
      this.error(`Expected a value at position ${this.chars.length + 1}.`, this.chars.length + 1);
    }
    if (this.peek() === ')' || this.peek() === '}') {
      this.error(`Expected a value at position ${this.index + 1}.`, this.index + 1);
    }
    if (this.peekKeyword() !== null) {
      this.skipSpaces();
      this.error(`Expected a value at position ${this.index + 1}.`, this.index + 1);
    }
    return this.readValue();
  }

  private readValue(): ReadValue {
    this.skipSpaces();
    const start = this.index;
    if (this.peek() === '"') {
      const open = this.index;
      this.index += 1;
      let text = '';
      for (;;) {
        if (this.atEnd()) {
          this.error(`Unclosed quote at position ${open + 1}.`, open + 1);
        }
        const char = this.chars[this.index];
        if (char === '\\') {
          const next = this.chars[this.index + 1];
          if (next !== undefined && ESCAPABLE.has(next)) {
            text += next;
            this.index += 2;
            continue;
          }
        }
        if (char === '"') {
          this.index += 1;
          break;
        }
        text += char;
        this.index += 1;
      }
      return { text, start: open, quoted: true, starRunes: [] };
    }
    let text = '';
    const starRunes: number[] = [];
    while (!this.atEnd()) {
      const char = this.chars[this.index];
      if (char === '\\') {
        const next = this.chars[this.index + 1];
        if (next !== undefined && ESCAPABLE.has(next)) {
          text += next;
          this.index += 2;
          continue;
        }
      }
      if (/[\s)}]/.test(char)) break;
      if (char === '*') starRunes.push(this.index);
      text += char;
      this.index += 1;
    }
    if (text === '') {
      this.error(`Expected a value at position ${this.index + 1}.`, this.index + 1);
    }
    return { text, start, quoted: false, starRunes };
  }

  private requireField(field: string, position: number, allowObject: boolean): FieldType {
    const type = this.lookup.typeOf(field);
    if (type !== undefined) return type;
    if (allowObject && this.lookup.hasObject(field)) return 'keyword';
    this.error(`Unknown field ${field} at position ${position}.`, position);
  }

  private buildBare(scope: string, word: ReadValue, position: number): QueryNode {
    const field = scope === '' ? 'message' : `${scope}.message`;
    const type = this.requireField(field, position, false);
    if (word.starRunes.length > 0) {
      if (type !== 'text' && type !== 'keyword') {
        const at = word.starRunes[0] + 1;
        this.error(`Wildcard not allowed on ${type} field ${field} at position ${at}.`, at);
      }
      return { kind: 'wildcard', field, type, pattern: word.text };
    }
    return this.textLeaf(field, word.text);
  }

  private buildLeaf(
    scope: string,
    name: string,
    namePosition: number,
    operator: ':' | '>' | '>=' | '<' | '<=',
    value: ReadValue,
    operatorPosition: number,
  ): QueryNode {
    const field = scope === '' ? name : `${scope}.${name}`;
    const type = this.requireField(field, namePosition, false);
    if (operator !== ':') {
      if (type !== 'number' && type !== 'date') {
        this.error(
          `Range not allowed on ${type} field ${field} at position ${operatorPosition}.`,
          operatorPosition,
        );
      }
      const numeric = this.rangeValue(type, value);
      const op = operator === '>' ? 'gt' : operator === '>=' ? 'gte' : operator === '<' ? 'lt' : 'lte';
      return { kind: 'range', field, type, op, value: numeric };
    }
    if (value.starRunes.length > 0) {
      if (type !== 'text' && type !== 'keyword') {
        const position = value.starRunes[0] + 1;
        this.error(
          `Wildcard not allowed on ${type} field ${field} at position ${position}.`,
          position,
        );
      }
      return { kind: 'wildcard', field, type, pattern: value.text };
    }
    if (type === 'number') {
      const numeric = Number(value.text);
      if (!Number.isFinite(numeric) || value.text.trim() === '') {
        this.error(`Expected a number at position ${value.start + 1}.`, value.start + 1);
      }
      return { kind: 'term', field, type, value: numeric };
    }
    if (type === 'boolean') {
      if (value.text !== 'true' && value.text !== 'false') {
        this.error(`Expected a value at position ${value.start + 1}.`, value.start + 1);
      }
      return { kind: 'term', field, type, value: value.text === 'true' };
    }
    if (type === 'date') {
      const parsed = parseDateValue(value.text, this.nowMs);
      if (parsed === null) {
        this.error(`Expected a value at position ${value.start + 1}.`, value.start + 1);
      }
      return { kind: 'term', field, type, value: value.text };
    }
    if (type === 'keyword') {
      return { kind: 'term', field, type, value: value.text };
    }
    return this.textLeaf(field, value.text);
  }

  private rangeValue(type: FieldType, value: ReadValue): number {
    if (type === 'number') {
      const numeric = Number(value.text);
      if (!Number.isFinite(numeric) || value.text.trim() === '') {
        this.error(`Expected a number at position ${value.start + 1}.`, value.start + 1);
      }
      return numeric;
    }
    const parsed = parseDateValue(value.text, this.nowMs);
    if (parsed === null) {
      this.error(`Expected a value at position ${value.start + 1}.`, value.start + 1);
    }
    return parsed;
  }

  /** An unquoted or quoted text value is analyzed; several tokens become a phrase. */
  private textLeaf(field: string, text: string): QueryNode {
    const analyzed = analyze('standard', text);
    if (analyzed.length === 0) {
      return { kind: 'phrase', field, tokens: [], slots: [], text };
    }
    if (analyzed.length === 1) {
      return { kind: 'term', field, type: 'text', value: analyzed[0].token };
    }
    return {
      kind: 'phrase',
      field,
      tokens: analyzed.map((token) => token.token),
      slots: analyzed.map((token) => token.position),
      text,
    };
  }
}

const RELATIVE_DATE = /^now(?:-(\d+)([smhdw]))?$/;

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60000,
  h: 3600000,
  d: 86400000,
  w: 604800000,
};

export function parseDateValue(text: string, nowMs: number): number | null {
  const relative = RELATIVE_DATE.exec(text);
  if (relative) {
    if (relative[1] === undefined) return nowMs;
    return nowMs - Number(relative[1]) * UNIT_MS[relative[2]];
  }
  if (isIsoDateString(text)) return Date.parse(text);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(text);
  if (dateOnly) return Date.parse(`${text}T00:00:00.000Z`);
  return null;
}

export function parseQuery(text: string, lookup: FieldLookup, nowMs: number): QueryNode | null {
  if (text.trim() === '') return null;
  return new Parser(text, lookup, nowMs).parse();
}

export function hasScoringLeaf(node: QueryNode | null): boolean {
  if (!node) return false;
  switch (node.kind) {
    case 'and':
    case 'or':
      return node.children.some(hasScoringLeaf);
    case 'not':
      return false;
    case 'scope':
      return hasScoringLeaf(node.child);
    case 'term':
      return node.type === 'text';
    case 'phrase':
      return true;
    default:
      return false;
  }
}

export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (char) => (char === '*' ? '.*' : `\\${char}`));
  return new RegExp(`^${escaped}$`);
}
