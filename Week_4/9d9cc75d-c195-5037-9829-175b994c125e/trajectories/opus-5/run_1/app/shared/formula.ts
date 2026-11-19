import type { FieldType } from './types.js';

export interface Pos {
  line: number;
  column: number;
}

export type BinOp = 'OR' | 'AND' | '=' | '<>' | '<' | '<=' | '>' | '>=' | '+' | '-' | '&' | '*' | '/' | '%';

export type Ast =
  | { k: 'num'; v: number; pos: Pos }
  | { k: 'str'; v: string; pos: Pos }
  | { k: 'bool'; v: boolean; pos: Pos }
  | { k: 'null'; pos: Pos }
  | { k: 'ref'; name: string; pos: Pos }
  | { k: 'param'; name: string; pos: Pos }
  | { k: 'unary'; op: '-' | 'NOT'; arg: Ast; pos: Pos }
  | { k: 'bin'; op: BinOp; l: Ast; r: Ast; pos: Pos }
  | { k: 'call'; name: string; args: Ast[]; pos: Pos }
  | { k: 'lod'; scope: 'AT' | 'PLUS' | 'MINUS'; dims: Ast[]; agg: Ast; pos: Pos };

export type ValueType = FieldType | 'null' | 'unknown';

interface Signature {
  args: ValueType[];
  result: ValueType;
  /** 'same-as-arg1' results take their type from the first argument. */
  sameAsArg1?: boolean;
  aggregate?: boolean;
  tableCalc?: boolean;
  matchArgs?: number[];
}

export const FUNCTIONS: Record<string, Signature> = {
  SUM: { args: ['number'], result: 'number', aggregate: true },
  AVG: { args: ['number'], result: 'number', aggregate: true },
  MEDIAN: { args: ['number'], result: 'number', aggregate: true },
  MIN: { args: ['number'], result: 'number', aggregate: true },
  MAX: { args: ['number'], result: 'number', aggregate: true },
  COUNT: { args: ['unknown'], result: 'number', aggregate: true },
  COUNT_UNIQUE: { args: ['unknown'], result: 'number', aggregate: true },
  IF: { args: ['boolean', 'unknown', 'unknown'], result: 'unknown', sameAsArg1: false, matchArgs: [1, 2] },
  IFNULL: { args: ['unknown', 'unknown'], result: 'unknown', matchArgs: [0, 1] },
  ISNULL: { args: ['unknown'], result: 'boolean' },
  ABS: { args: ['number'], result: 'number' },
  ROUND: { args: ['number', 'number'], result: 'number' },
  UPPER: { args: ['text'], result: 'text' },
  LOWER: { args: ['text'], result: 'text' },
  LEN: { args: ['text'], result: 'number' },
  LEFT: { args: ['text', 'number'], result: 'text' },
  RIGHT: { args: ['text', 'number'], result: 'text' },
  CONTAINS: { args: ['text', 'text'], result: 'boolean' },
  PART_OF: { args: ['date', 'text'], result: 'number' },
  TRUNC_TO: { args: ['date', 'text'], result: 'date' },
  DAYS_BETWEEN: { args: ['date', 'date'], result: 'number' },
  NUM: { args: ['text'], result: 'number' },
  TEXT: { args: ['unknown'], result: 'text' },
  RUN_TOTAL: { args: ['number'], result: 'number', tableCalc: true },
  PREV_DIFF: { args: ['number'], result: 'number', tableCalc: true },
  SHARE: { args: ['number'], result: 'number', tableCalc: true },
  RANK_OF: { args: ['number'], result: 'number', tableCalc: true },
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();

type TokenKind = 'num' | 'str' | 'name' | 'ref' | 'param' | 'op' | 'punc' | 'bad' | 'eof';

interface Token {
  kind: TokenKind;
  text: string;
  value?: string | number;
  pos: Pos;
}

const KEYWORDS = new Set(['TRUE', 'FALSE', 'NULL', 'NOT', 'AND', 'OR', 'AT', 'PLUS', 'MINUS']);

class Lexer {
  private i = 0;
  private line = 1;
  private col = 1;

  constructor(private readonly src: string) {}

  private pos(): Pos {
    return { line: this.line, column: this.col };
  }

  private advance(n = 1): void {
    for (let j = 0; j < n; j += 1) {
      if (this.src[this.i] === '\n') {
        this.line += 1;
        this.col = 1;
      } else {
        this.col += 1;
      }
      this.i += 1;
    }
  }

  tokens(): Token[] {
    const out: Token[] = [];
    for (;;) {
      while (this.i < this.src.length && /[ \t\r\n]/.test(this.src[this.i])) this.advance();
      if (this.i >= this.src.length) {
        out.push({ kind: 'eof', text: '', pos: this.pos() });
        return out;
      }
      const start = this.pos();
      const ch = this.src[this.i];
      if (/[0-9]/.test(ch)) {
        let text = '';
        while (this.i < this.src.length && /[0-9]/.test(this.src[this.i])) {
          text += this.src[this.i];
          this.advance();
        }
        if (this.src[this.i] === '.' && /[0-9]/.test(this.src[this.i + 1] ?? '')) {
          text += '.';
          this.advance();
          while (this.i < this.src.length && /[0-9]/.test(this.src[this.i])) {
            text += this.src[this.i];
            this.advance();
          }
        }
        out.push({ kind: 'num', text, value: Number(text), pos: start });
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let text = '';
        while (this.i < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.i])) {
          text += this.src[this.i];
          this.advance();
        }
        out.push({ kind: 'name', text, pos: start });
        continue;
      }
      if (ch === "'") {
        this.advance();
        let text = '';
        let closed = false;
        while (this.i < this.src.length) {
          const c = this.src[this.i];
          if (c === "'") {
            if (this.src[this.i + 1] === "'") {
              text += "'";
              this.advance(2);
              continue;
            }
            this.advance();
            closed = true;
            break;
          }
          text += c;
          this.advance();
        }
        if (!closed) {
          out.push({ kind: 'bad', text: `'${text}`, pos: start });
          continue;
        }
        out.push({ kind: 'str', text: `'${text}'`, value: text, pos: start });
        continue;
      }
      if (ch === '[') {
        this.advance();
        let text = '';
        let closed = false;
        while (this.i < this.src.length) {
          const c = this.src[this.i];
          if (c === ']') {
            this.advance();
            closed = true;
            break;
          }
          text += c;
          this.advance();
        }
        if (!closed) {
          out.push({ kind: 'bad', text: `[${text}`, pos: start });
          continue;
        }
        if (text.startsWith('@')) {
          out.push({ kind: 'param', text: `[${text}]`, value: text.slice(1), pos: start });
        } else {
          out.push({ kind: 'ref', text: `[${text}]`, value: text, pos: start });
        }
        continue;
      }
      const two = this.src.slice(this.i, this.i + 2);
      if (two === '<>' || two === '<=' || two === '>=') {
        this.advance(2);
        out.push({ kind: 'op', text: two, pos: start });
        continue;
      }
      if ('=<>+-&*/%'.includes(ch)) {
        this.advance();
        out.push({ kind: 'op', text: ch, pos: start });
        continue;
      }
      if ('(),{}:'.includes(ch)) {
        this.advance();
        out.push({ kind: 'punc', text: ch, pos: start });
        continue;
      }
      this.advance();
      out.push({ kind: 'bad', text: ch, pos: start });
    }
  }
}

export interface ParseError {
  message: string;
  line: number;
  column: number;
}

export interface ParseOutput {
  ast: Ast | null;
  error: ParseError | null;
  depthError: ParseError | null;
}

class Parser {
  private at = 0;
  private depth = 0;
  depthError: ParseError | null = null;

  constructor(
    private readonly toks: Token[],
    private readonly maxDepth: number,
  ) {}

  private peek(): Token {
    return this.toks[this.at];
  }

  private next(): Token {
    const t = this.toks[this.at];
    if (t.kind !== 'eof') this.at += 1;
    return t;
  }

  private fail(tok: Token): never {
    if (tok.kind === 'eof') {
      throw { message: `Line ${tok.pos.line}, column ${tok.pos.column}: formula ended early.`, line: tok.pos.line, column: tok.pos.column };
    }
    throw {
      message: `Line ${tok.pos.line}, column ${tok.pos.column}: unexpected "${tok.text}".`,
      line: tok.pos.line,
      column: tok.pos.column,
    };
  }

  private open(tok: Token): void {
    this.depth += 1;
    if (this.depth > this.maxDepth && this.depthError === null) {
      this.depthError = {
        message: `Line ${tok.pos.line}, column ${tok.pos.column}: nested deeper than ${this.maxDepth} levels.`,
        line: tok.pos.line,
        column: tok.pos.column,
      };
    }
  }

  private close(): void {
    this.depth -= 1;
  }

  parse(): Ast {
    const ast = this.parseOr();
    const tok = this.peek();
    if (tok.kind !== 'eof') this.fail(tok);
    return ast;
  }

  private parseOr(): Ast {
    let left = this.parseAnd();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'name' && tok.text === 'OR') {
        this.next();
        const right = this.parseAnd();
        left = { k: 'bin', op: 'OR', l: left, r: right, pos: tok.pos };
        continue;
      }
      return left;
    }
  }

  private parseAnd(): Ast {
    let left = this.parseNot();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'name' && tok.text === 'AND') {
        this.next();
        const right = this.parseNot();
        left = { k: 'bin', op: 'AND', l: left, r: right, pos: tok.pos };
        continue;
      }
      return left;
    }
  }

  private parseNot(): Ast {
    const tok = this.peek();
    if (tok.kind === 'name' && tok.text === 'NOT') {
      this.next();
      return { k: 'unary', op: 'NOT', arg: this.parseNot(), pos: tok.pos };
    }
    return this.parseComparison();
  }

  private parseComparison(): Ast {
    let left = this.parseAdditive();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(tok.text)) {
        this.next();
        const right = this.parseAdditive();
        left = { k: 'bin', op: tok.text as BinOp, l: left, r: right, pos: tok.pos };
        continue;
      }
      return left;
    }
  }

  private parseAdditive(): Ast {
    let left = this.parseMultiplicative();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'op' && ['+', '-', '&'].includes(tok.text)) {
        this.next();
        const right = this.parseMultiplicative();
        left = { k: 'bin', op: tok.text as BinOp, l: left, r: right, pos: tok.pos };
        continue;
      }
      return left;
    }
  }

  private parseMultiplicative(): Ast {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'op' && ['*', '/', '%'].includes(tok.text)) {
        this.next();
        const right = this.parseUnary();
        left = { k: 'bin', op: tok.text as BinOp, l: left, r: right, pos: tok.pos };
        continue;
      }
      return left;
    }
  }

  private parseUnary(): Ast {
    const tok = this.peek();
    if (tok.kind === 'op' && tok.text === '-') {
      this.next();
      return { k: 'unary', op: '-', arg: this.parseUnary(), pos: tok.pos };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Ast {
    const tok = this.next();
    if (tok.kind === 'num') return { k: 'num', v: tok.value as number, pos: tok.pos };
    if (tok.kind === 'str') return { k: 'str', v: tok.value as string, pos: tok.pos };
    if (tok.kind === 'ref') return { k: 'ref', name: tok.value as string, pos: tok.pos };
    if (tok.kind === 'param') return { k: 'param', name: tok.value as string, pos: tok.pos };
    if (tok.kind === 'punc' && tok.text === '(') {
      this.open(tok);
      const inner = this.parseOr();
      const closeTok = this.next();
      if (!(closeTok.kind === 'punc' && closeTok.text === ')')) this.fail(closeTok);
      this.close();
      return inner;
    }
    if (tok.kind === 'punc' && tok.text === '{') {
      return this.parseLod(tok);
    }
    if (tok.kind === 'name') {
      if (tok.text === 'TRUE') return { k: 'bool', v: true, pos: tok.pos };
      if (tok.text === 'FALSE') return { k: 'bool', v: false, pos: tok.pos };
      if (tok.text === 'NULL') return { k: 'null', pos: tok.pos };
      const open = this.peek();
      if (open.kind === 'punc' && open.text === '(' && !KEYWORDS.has(tok.text)) {
        this.next();
        this.open(open);
        const args: Ast[] = [];
        if (!(this.peek().kind === 'punc' && this.peek().text === ')')) {
          for (;;) {
            args.push(this.parseOr());
            const sep = this.peek();
            if (sep.kind === 'punc' && sep.text === ',') {
              this.next();
              continue;
            }
            break;
          }
        }
        const closeTok = this.next();
        if (!(closeTok.kind === 'punc' && closeTok.text === ')')) this.fail(closeTok);
        this.close();
        return { k: 'call', name: tok.text, args, pos: tok.pos };
      }
      this.fail(tok);
    }
    this.fail(tok);
  }

  private parseLod(brace: Token): Ast {
    this.open(brace);
    const head = this.peek();
    let scope: 'AT' | 'PLUS' | 'MINUS' = 'AT';
    const dims: Ast[] = [];
    if (head.kind === 'name' && (head.text === 'AT' || head.text === 'PLUS' || head.text === 'MINUS')) {
      this.next();
      scope = head.text;
      for (;;) {
        dims.push(this.parseOr());
        const sep = this.peek();
        if (sep.kind === 'punc' && sep.text === ',') {
          this.next();
          continue;
        }
        break;
      }
      const colon = this.next();
      if (!(colon.kind === 'punc' && colon.text === ':')) this.fail(colon);
    }
    const agg = this.parseOr();
    const closeTok = this.next();
    if (!(closeTok.kind === 'punc' && closeTok.text === '}')) this.fail(closeTok);
    this.close();
    return { k: 'lod', scope, dims, agg, pos: brace.pos };
  }
}

export function parseFormula(src: string, maxDepth: number): ParseOutput {
  const toks = new Lexer(src).tokens();
  const parser = new Parser(toks, maxDepth);
  try {
    const ast = parser.parse();
    return { ast, error: null, depthError: parser.depthError };
  } catch (err) {
    return { ast: null, error: err as ParseError, depthError: parser.depthError };
  }
}

export function walk(node: Ast, visit: (n: Ast) => void): void {
  visit(node);
  switch (node.k) {
    case 'unary':
      walk(node.arg, visit);
      break;
    case 'bin':
      walk(node.l, visit);
      walk(node.r, visit);
      break;
    case 'call':
      node.args.forEach((a) => walk(a, visit));
      break;
    case 'lod':
      node.dims.forEach((d) => walk(d, visit));
      walk(node.agg, visit);
      break;
    default:
      break;
  }
}

export function countNodes(node: Ast): number {
  let n = 0;
  walk(node, () => {
    n += 1;
  });
  return n;
}

/** A level-of-detail expression gives one number per row, so aggregates inside it do not make the formula aggregate. */
export function hasAggregate(node: Ast): boolean {
  switch (node.k) {
    case 'call': {
      const sig = FUNCTIONS[node.name];
      if (sig?.aggregate === true || sig?.tableCalc === true) return true;
      return node.args.some(hasAggregate);
    }
    case 'unary':
      return hasAggregate(node.arg);
    case 'bin':
      return hasAggregate(node.l) || hasAggregate(node.r);
    default:
      return false;
  }
}

export function isLodFormula(src: string): boolean {
  const t = src.trim();
  return t.startsWith('{') && t.endsWith('}');
}

/** Nodes in the row-level part: the whole formula when it has no aggregate, else nodes inside aggregate arguments. */
export function rowLevelNodes(node: Ast): number {
  if (!hasAggregate(node)) return countNodes(node);
  let total = 0;
  const visit = (n: Ast, insideAggregate: boolean): void => {
    if (insideAggregate) total += 1;
    switch (n.k) {
      case 'unary':
        visit(n.arg, insideAggregate);
        break;
      case 'bin':
        visit(n.l, insideAggregate);
        visit(n.r, insideAggregate);
        break;
      case 'call': {
        const sig = FUNCTIONS[n.name];
        const aggregating = insideAggregate || sig?.aggregate === true || sig?.tableCalc === true;
        n.args.forEach((a) => visit(a, aggregating));
        break;
      }
      case 'lod':
        visit(n.agg, insideAggregate);
        break;
      default:
        break;
    }
  };
  visit(node, false);
  return total;
}
