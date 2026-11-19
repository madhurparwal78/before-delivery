// The grammar, precedence lowest first: OR; AND; NOT; comparisons; + - &; * / %; unary -. The parser keeps its own
// stacks instead of recursing, so the time and the stack it needs grow linearly with the text, however deep it nests.
// Errors: a syntax error (check 2) wins over a nesting error (check 3), which is the first token opening a level past
// the limit.
import { errorAt, type BinaryOp, type FieldNode, type FormulaError, type LodForm, type Node } from './ast.ts';
import { Lexer, type Pos, type Token } from './lexer.ts';

const BINARY: Record<string, { op: BinaryOp; prec: number }> = {
  OR: { op: 'OR', prec: 1 },
  AND: { op: 'AND', prec: 2 },
  '=': { op: '=', prec: 4 },
  '<>': { op: '<>', prec: 4 },
  '<': { op: '<', prec: 4 },
  '<=': { op: '<=', prec: 4 },
  '>': { op: '>', prec: 4 },
  '>=': { op: '>=', prec: 4 },
  '+': { op: '+', prec: 5 },
  '-': { op: '-', prec: 5 },
  '&': { op: '&', prec: 5 },
  '*': { op: '*', prec: 6 },
  '/': { op: '/', prec: 6 },
  '%': { op: '%', prec: 6 },
};
const NOT_PREC = 3;
const NEGATE_PREC = 7;
const LOD_FORMS = new Set(['AT', 'PLUS', 'MINUS']);

type Frame =
  | { kind: 'prefix'; op: '-' | 'NOT'; prec: number; token: Token }
  | { kind: 'binary'; op: BinaryOp; prec: number; token: Token; left: Node }
  | { kind: 'paren'; token: Token }
  | { kind: 'call'; token: Token; args: Node[] }
  | { kind: 'lod'; token: Token; form: LodForm; dims: FieldNode[] };

export type Parsed = { ok: true; node: Node } | { ok: false; error: FormulaError };

class SyntaxProblem {
  constructor(readonly error: FormulaError) {}
}

class Parser {
  private readonly lexer: Lexer;
  private readonly stack: Frame[] = [];
  private operand: Node | null = null;
  private depth = 0;
  private tooDeep: Pos | null = null;

  constructor(
    text: string,
    private readonly maxDepth: number,
  ) {
    this.lexer = new Lexer(text);
  }

  parse(): Parsed {
    try {
      const node = this.run();
      if (this.tooDeep) return { ok: false, error: errorAt(this.tooDeep, `nested deeper than ${this.maxDepth} levels.`) };
      return { ok: true, node };
    } catch (problem) {
      if (problem instanceof SyntaxProblem) return { ok: false, error: problem.error };
      throw problem;
    }
  }

  private run(): Node {
    let token = this.lexer.next();
    for (;;) {
      token = this.operand === null ? this.readOperand(token) : this.readOperator(token);
      if (token.kind === 'end' && this.operand !== null && this.stack.length === 0) return this.operand;
    }
  }

  /** Expects the start of an operand; returns the next token to read. */
  private readOperand(token: Token): Token {
    const at = { pos: token.pos, start: token.pos };
    switch (token.kind) {
      case 'number':
        this.operand = { ...at, type: 'number', value: Number(token.text) };
        return this.lexer.next();
      case 'string':
        this.operand = { ...at, type: 'string', value: token.value };
        return this.lexer.next();
      case 'field':
        this.operand = { ...at, type: 'field', name: token.value };
        return this.lexer.next();
      case 'param':
        this.operand = { ...at, type: 'param', name: token.value };
        return this.lexer.next();
      case 'op':
        if (token.text !== '-') break;
        this.stack.push({ kind: 'prefix', op: '-', prec: NEGATE_PREC, token });
        return this.lexer.next();
      case '(':
        this.open(token);
        this.stack.push({ kind: 'paren', token });
        return this.lexer.next();
      case '{':
        return this.openLod(token);
      case 'name':
        return this.readName(token);
      default:
        break;
    }
    return this.fail(token);
  }

  private readName(token: Token): Token {
    const at = { pos: token.pos, start: token.pos };
    switch (token.text) {
      case 'TRUE':
      case 'FALSE':
        this.operand = { ...at, type: 'boolean', value: token.text === 'TRUE' };
        return this.lexer.next();
      case 'NULL':
        this.operand = { ...at, type: 'null' };
        return this.lexer.next();
      case 'NOT':
        this.stack.push({ kind: 'prefix', op: 'NOT', prec: NOT_PREC, token });
        return this.lexer.next();
      default:
        break;
    }
    const after = this.lexer.next();
    if (after.kind !== '(') return this.fail(token);
    this.open(after);
    const close = this.lexer.next();
    if (close.kind === ')') {
      this.depth--;
      this.operand = { ...at, type: 'call', name: token.text, args: [] };
      return this.lexer.next();
    }
    this.stack.push({ kind: 'call', token, args: [] });
    return close;
  }

  private openLod(brace: Token): Token {
    this.open(brace);
    const first = this.lexer.next();
    if (first.kind !== 'name' || !LOD_FORMS.has(first.text)) {
      this.stack.push({ kind: 'lod', token: brace, form: 'ALL', dims: [] });
      return first;
    }
    const dims: FieldNode[] = [];
    for (;;) {
      const dim = this.lexer.next();
      if (dim.kind !== 'field') return this.fail(dim);
      dims.push({ type: 'field', name: dim.value, pos: dim.pos, start: dim.pos });
      const separator = this.lexer.next();
      if (separator.kind === ':') break;
      if (separator.kind !== ',') return this.fail(separator);
    }
    this.stack.push({ kind: 'lod', token: brace, form: first.text as LodForm, dims });
    return this.lexer.next();
  }

  /** Expects an operator, a separator or a closer after a complete operand. */
  private readOperator(token: Token): Token {
    const binary = token.kind === 'op' || token.kind === 'name' ? BINARY[token.text] : undefined;
    if (binary) {
      const left = this.reduce(binary.prec);
      this.stack.push({ kind: 'binary', op: binary.op, prec: binary.prec, token, left });
      this.operand = null;
      return this.lexer.next();
    }
    if (token.kind === 'end') {
      this.reduce(0);
      if (this.stack.length > 0) return this.fail(token);
      return token;
    }
    const value = this.reduce(0);
    const frame = this.stack[this.stack.length - 1];
    if (token.kind === ',' && frame?.kind === 'call') {
      frame.args.push(value);
      this.operand = null;
      return this.lexer.next();
    }
    if (token.kind === ')' && frame?.kind === 'paren') {
      this.stack.pop();
      this.depth--;
      return this.lexer.next();
    }
    if (token.kind === ')' && frame?.kind === 'call') {
      this.stack.pop();
      this.depth--;
      const at = { pos: frame.token.pos, start: frame.token.pos };
      this.operand = { ...at, type: 'call', name: frame.token.text, args: [...frame.args, value] };
      return this.lexer.next();
    }
    if (token.kind === '}' && frame?.kind === 'lod') {
      this.stack.pop();
      this.depth--;
      const at = { pos: frame.token.pos, start: frame.token.pos };
      this.operand = { ...at, type: 'lod', form: frame.form, dims: frame.dims, body: value };
      return this.lexer.next();
    }
    return this.fail(token);
  }

  /** Applies stacked operators binding at least as tightly as `prec` to the current operand. */
  private reduce(prec: number): Node {
    let value = this.operand;
    if (value === null) throw new Error('reduce without an operand');
    for (;;) {
      const top = this.stack[this.stack.length - 1];
      if (!top || (top.kind !== 'prefix' && top.kind !== 'binary') || top.prec < prec) break;
      this.stack.pop();
      const pos = top.token.pos;
      value =
        top.kind === 'prefix'
          ? { type: 'unary', op: top.op, arg: value, pos, start: pos }
          : { type: 'binary', op: top.op, left: top.left, right: value, pos, start: top.left.start };
    }
    this.operand = value;
    return value;
  }

  private open(token: Token): void {
    this.depth++;
    if (this.depth > this.maxDepth && this.tooDeep === null) this.tooDeep = token.pos;
  }

  private fail(token: Token): never {
    if (token.kind === 'end' || token.kind === 'open') {
      throw new SyntaxProblem(errorAt(this.lexer.endPos(), 'formula ended early.'));
    }
    throw new SyntaxProblem(errorAt(token.pos, `unexpected "${token.text}".`));
  }
}

export function parseFormula(text: string, maxDepth: number): Parsed {
  return new Parser(text, maxDepth).parse();
}
