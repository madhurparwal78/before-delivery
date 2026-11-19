/**
 * Recursive-descent parser for the published grammar. Precedence, lowest first:
 * or, and, not, comparisons (not chainable), + -, * /, unary -.
 */

import {
  comparisonOperators,
  functionArity,
  isFunctionName,
  type BinaryOperator,
  type Node,
  type ParsedExpression,
  type SemanticIssue,
} from './ast';
import { ExpressionSyntaxError, tokenize, type Token } from './lexer';

const keywords = new Set(['or', 'and', 'not', 'in', 'contains', 'startswith', 'true', 'false', 'null']);

class Parser {
  private at = 0;
  readonly issues: SemanticIssue[] = [];

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.at];
  }

  private next(): Token {
    return this.tokens[this.at++];
  }

  private isPunct(text: string): boolean {
    const t = this.peek();
    return t.kind === 'punct' && t.text === text;
  }

  private isKeyword(word: string): boolean {
    const t = this.peek();
    return t.kind === 'ident' && t.text === word;
  }

  parseWhole(): Node {
    const node = this.parseOr();
    const t = this.peek();
    if (t.kind !== 'eof') throw new ExpressionSyntaxError(t.col, `unexpected "${t.text}"`);
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.isKeyword('or')) {
      const col = this.next().col;
      const right = this.parseAnd();
      left = { kind: 'binary', op: 'or', left, right, col };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.isKeyword('and')) {
      const col = this.next().col;
      const right = this.parseNot();
      left = { kind: 'binary', op: 'and', left, right, col };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.isKeyword('not')) {
      const col = this.next().col;
      return { kind: 'not', operand: this.parseNot(), col };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parseAdditive();
    const t = this.peek();
    const op = this.comparisonAt(t);
    if (!op) return left;
    this.next();
    const right = this.parseAdditive();
    // Comparisons are not chainable.
    const after = this.peek();
    if (this.comparisonAt(after)) throw new ExpressionSyntaxError(after.col, `unexpected "${after.text}"`);
    return { kind: 'binary', op, left, right, col: t.col };
  }

  private comparisonAt(t: Token): BinaryOperator | null {
    if (t.kind === 'punct' && (comparisonOperators as readonly string[]).includes(t.text)) {
      return t.text as BinaryOperator;
    }
    if (t.kind === 'ident' && (t.text === 'in' || t.text === 'contains' || t.text === 'startswith')) {
      return t.text;
    }
    return null;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    for (;;) {
      if (this.isPunct('+') || this.isPunct('-')) {
        const t = this.next();
        const right = this.parseMultiplicative();
        left = { kind: 'binary', op: t.text as BinaryOperator, left, right, col: t.col };
        continue;
      }
      return left;
    }
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    for (;;) {
      if (this.isPunct('*') || this.isPunct('/')) {
        const t = this.next();
        const right = this.parseUnary();
        left = { kind: 'binary', op: t.text as BinaryOperator, left, right, col: t.col };
        continue;
      }
      return left;
    }
  }

  private parseUnary(): Node {
    if (this.isPunct('-')) {
      const col = this.next().col;
      return { kind: 'negate', operand: this.parseUnary(), col };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (t.kind === 'number') {
      this.next();
      return { kind: 'number', value: t.value as number, col: t.col };
    }
    if (t.kind === 'string') {
      this.next();
      return { kind: 'string', value: t.value as string, col: t.col };
    }
    if (t.kind === 'punct' && t.text === '(') {
      this.next();
      const inner = this.parseOr();
      const close = this.peek();
      if (!(close.kind === 'punct' && close.text === ')')) {
        throw new ExpressionSyntaxError(close.col, 'expected ")"');
      }
      this.next();
      return inner;
    }
    if (t.kind === 'punct' && t.text === '[') {
      this.next();
      const items: Node[] = [];
      if (!this.isPunct(']')) {
        for (;;) {
          items.push(this.parseOr());
          if (this.isPunct(',')) {
            this.next();
            continue;
          }
          break;
        }
      }
      const close = this.peek();
      if (!(close.kind === 'punct' && close.text === ']')) {
        throw new ExpressionSyntaxError(close.col, `unexpected "${close.text}"`);
      }
      this.next();
      return { kind: 'list', items, col: t.col };
    }
    if (t.kind === 'ident') {
      if (t.text === 'true' || t.text === 'false') {
        this.next();
        return { kind: 'boolean', value: t.text === 'true', col: t.col };
      }
      if (t.text === 'null') {
        this.next();
        return { kind: 'null', col: t.col };
      }
      if (keywords.has(t.text)) throw new ExpressionSyntaxError(t.col, 'expected a value');
      // A name followed by "(" is a function call; otherwise it starts a path.
      const after = this.tokens[this.at + 1];
      if (after && after.kind === 'punct' && after.text === '(') {
        return this.parseCall();
      }
      return this.parsePath();
    }
    throw new ExpressionSyntaxError(t.col, 'expected a value');
  }

  private parseCall(): Node {
    const nameToken = this.next();
    this.next(); // "("
    const args: Node[] = [];
    if (!this.isPunct(')')) {
      for (;;) {
        args.push(this.parseOr());
        if (this.isPunct(',')) {
          this.next();
          continue;
        }
        break;
      }
    }
    const close = this.peek();
    if (!(close.kind === 'punct' && close.text === ')')) {
      throw new ExpressionSyntaxError(close.col, 'expected ")"');
    }
    this.next();
    const name = nameToken.text;
    if (!isFunctionName(name)) {
      this.issues.push({ col: nameToken.col, reason: `unknown function "${name}"` });
      return { kind: 'null', col: nameToken.col };
    }
    if (functionArity[name] !== args.length) {
      this.issues.push({ col: nameToken.col, reason: `unknown function "${name}"` });
      return { kind: 'null', col: nameToken.col };
    }
    return { kind: 'call', name, args, col: nameToken.col };
  }

  private parsePath(): Node {
    const first = this.next();
    const parts = [first.text];
    while (this.isPunct('.')) {
      this.next();
      const part = this.peek();
      if (part.kind !== 'ident') throw new ExpressionSyntaxError(part.col, 'expected a value');
      this.next();
      parts.push(part.text);
    }
    return { kind: 'path', path: parts, col: first.col };
  }
}

export function parse(text: string): ParsedExpression {
  const parser = new Parser(tokenize(text));
  const node = parser.parseWhole();
  return { text, node, issues: parser.issues.sort((a, b) => a.col - b.col) };
}
