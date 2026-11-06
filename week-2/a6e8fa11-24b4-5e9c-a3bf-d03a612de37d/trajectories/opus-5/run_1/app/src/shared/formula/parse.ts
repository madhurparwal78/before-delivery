import { LIMITS } from '../limits';
import { RangeAddress, columnNumber } from '../refs';

export type BinaryOperator = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=';

export interface RefNode {
  k: 'ref';
  sheetName: string | null;
  range: RangeAddress;
  /** True for `D:D` style references, which cover rows 1 to maxRows. */
  wholeColumn: boolean;
  single: boolean;
}

export type FormulaNode =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'name'; v: string }
  | RefNode
  | { k: 'unary'; op: '-' | '+'; a: FormulaNode }
  | { k: 'binary'; op: BinaryOperator; a: FormulaNode; b: FormulaNode }
  | { k: 'call'; name: string; args: FormulaNode[] };

export interface ParsedFormula {
  root: FormulaNode;
  nodeCount: number;
  cellsCovered: number;
  refs: RefNode[];
}

class SyntaxFailure extends Error {}

type TokenType = 'num' | 'str' | 'ref' | 'name' | 'op' | '(' | ')' | ',';

interface Token {
  type: TokenType;
  text: string;
  num?: number;
  str?: string;
  ref?: RefNode;
}

const RANGE_RE = /^\$?([A-Za-z]{1,2})\$?(\d{1,7}):\$?([A-Za-z]{1,2})\$?(\d{1,7})/;
const WHOLE_COL_RE = /^\$?([A-Za-z]{1,2}):\$?([A-Za-z]{1,2})(?![A-Za-z0-9_$])/;
const CELL_RE = /^\$?([A-Za-z]{1,2})\$?(\d{1,7})(?![A-Za-z0-9_$])/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;
const SHEET_PREFIX_RE = /^(?:'([^']*)'|([A-Za-z_][A-Za-z0-9_]*))!/;
const NUM_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

function makeRange(startCol: number, startRow: number, endCol: number, endRow: number): RangeAddress {
  return {
    startCol: Math.min(startCol, endCol),
    startRow: Math.min(startRow, endRow),
    endCol: Math.max(startCol, endCol),
    endRow: Math.max(startRow, endRow),
  };
}

function readLocalRef(source: string, sheetName: string | null): { ref: RefNode; length: number } | null {
  const range = RANGE_RE.exec(source);
  if (range) {
    return {
      ref: {
        k: 'ref',
        sheetName,
        range: makeRange(columnNumber(range[1]), Number(range[2]), columnNumber(range[3]), Number(range[4])),
        wholeColumn: false,
        single: false,
      },
      length: range[0].length,
    };
  }
  const whole = WHOLE_COL_RE.exec(source);
  if (whole) {
    return {
      ref: {
        k: 'ref',
        sheetName,
        range: makeRange(columnNumber(whole[1]), 1, columnNumber(whole[2]), LIMITS.maxRows),
        wholeColumn: true,
        single: false,
      },
      length: whole[0].length,
    };
  }
  const cell = CELL_RE.exec(source);
  if (cell) {
    const col = columnNumber(cell[1]);
    const row = Number(cell[2]);
    return {
      ref: { k: 'ref', sheetName, range: makeRange(col, row, col, row), wholeColumn: false, single: true },
      length: cell[0].length,
    };
  }
  return null;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    const rest = source.slice(i);
    if (ch === '"') {
      let j = i + 1;
      let text = '';
      for (;;) {
        if (j >= source.length) throw new SyntaxFailure('unterminated string');
        if (source[j] === '"') {
          if (source[j + 1] === '"') {
            text += '"';
            j += 2;
            continue;
          }
          j++;
          break;
        }
        text += source[j];
        j++;
      }
      tokens.push({ type: 'str', text: source.slice(i, j), str: text });
      i = j;
      continue;
    }
    const sheet = SHEET_PREFIX_RE.exec(rest);
    if (sheet) {
      const sheetName = sheet[1] !== undefined ? sheet[1] : sheet[2];
      const local = readLocalRef(rest.slice(sheet[0].length), sheetName);
      if (!local) throw new SyntaxFailure('bad sheet reference');
      tokens.push({ type: 'ref', text: rest.slice(0, sheet[0].length + local.length), ref: local.ref });
      i += sheet[0].length + local.length;
      continue;
    }
    if (/[A-Za-z$]/.test(ch)) {
      const local = readLocalRef(rest, null);
      if (local) {
        tokens.push({ type: 'ref', text: rest.slice(0, local.length), ref: local.ref });
        i += local.length;
        continue;
      }
      const name = NAME_RE.exec(rest);
      if (name) {
        tokens.push({ type: 'name', text: name[0] });
        i += name[0].length;
        continue;
      }
      throw new SyntaxFailure('bad name');
    }
    if (/[0-9.]/.test(ch)) {
      const num = NUM_RE.exec(rest);
      if (!num) throw new SyntaxFailure('bad number');
      tokens.push({ type: 'num', text: num[0], num: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ type: ch, text: ch });
      i++;
      continue;
    }
    const two = rest.slice(0, 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      tokens.push({ type: 'op', text: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>'.includes(ch)) {
      tokens.push({ type: 'op', text: ch });
      i++;
      continue;
    }
    throw new SyntaxFailure(`unexpected character ${ch}`);
  }
  return tokens;
}

class Parser {
  private at = 0;
  nodeCount = 0;
  cellsCovered = 0;
  refs: RefNode[] = [];

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private take(): Token {
    const token = this.tokens[this.at];
    if (!token) throw new SyntaxFailure('unexpected end');
    this.at++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.take();
    if (token.type !== type) throw new SyntaxFailure(`expected ${type}`);
    return token;
  }

  private eatOperator(options: readonly string[]): string | null {
    const token = this.peek();
    if (token && token.type === 'op' && options.includes(token.text)) {
      this.at++;
      return token.text;
    }
    return null;
  }

  parse(): FormulaNode {
    const node = this.comparison();
    if (this.at !== this.tokens.length) throw new SyntaxFailure('trailing input');
    return node;
  }

  private comparison(): FormulaNode {
    let left = this.concat();
    for (;;) {
      const op = this.eatOperator(['=', '<>', '<', '<=', '>', '>=']);
      if (!op) return left;
      this.nodeCount++;
      left = { k: 'binary', op: op as BinaryOperator, a: left, b: this.concat() };
    }
  }

  private concat(): FormulaNode {
    let left = this.additive();
    for (;;) {
      const op = this.eatOperator(['&']);
      if (!op) return left;
      this.nodeCount++;
      left = { k: 'binary', op: '&', a: left, b: this.additive() };
    }
  }

  private additive(): FormulaNode {
    let left = this.multiplicative();
    for (;;) {
      const op = this.eatOperator(['+', '-']);
      if (!op) return left;
      this.nodeCount++;
      left = { k: 'binary', op: op as BinaryOperator, a: left, b: this.multiplicative() };
    }
  }

  private multiplicative(): FormulaNode {
    let left = this.power();
    for (;;) {
      const op = this.eatOperator(['*', '/']);
      if (!op) return left;
      this.nodeCount++;
      left = { k: 'binary', op: op as BinaryOperator, a: left, b: this.power() };
    }
  }

  private power(): FormulaNode {
    const left = this.unary();
    const op = this.eatOperator(['^']);
    if (!op) return left;
    this.nodeCount++;
    return { k: 'binary', op: '^', a: left, b: this.power() };
  }

  private unary(): FormulaNode {
    const op = this.eatOperator(['-', '+']);
    if (op) {
      this.nodeCount++;
      return { k: 'unary', op: op as '-' | '+', a: this.unary() };
    }
    return this.primary();
  }

  private primary(): FormulaNode {
    const token = this.take();
    if (token.type === '(') {
      const inner = this.comparison();
      this.expect(')');
      return inner;
    }
    if (token.type === 'num') {
      this.nodeCount++;
      return { k: 'num', v: token.num as number };
    }
    if (token.type === 'str') {
      this.nodeCount++;
      return { k: 'str', v: token.str as string };
    }
    if (token.type === 'ref') {
      this.nodeCount++;
      const ref = token.ref as RefNode;
      this.refs.push(ref);
      const rows = ref.range.endRow - ref.range.startRow + 1;
      const cols = ref.range.endCol - ref.range.startCol + 1;
      this.cellsCovered += rows * cols;
      return ref;
    }
    if (token.type === 'name') {
      const upper = token.text.toUpperCase();
      if (this.peek()?.type === '(') {
        this.at++;
        const args: FormulaNode[] = [];
        if (this.peek()?.type !== ')') {
          for (;;) {
            args.push(this.comparison());
            if (this.peek()?.type === ',') {
              this.at++;
              continue;
            }
            break;
          }
        }
        this.expect(')');
        this.nodeCount++;
        return { k: 'call', name: upper, args };
      }
      this.nodeCount++;
      if (upper === 'TRUE') return { k: 'bool', v: true };
      if (upper === 'FALSE') return { k: 'bool', v: false };
      return { k: 'name', v: token.text };
    }
    throw new SyntaxFailure('unexpected token');
  }
}

/** Parses a formula body (the text after `=`). Returns null for a syntax error. */
export function parseFormula(source: string): ParsedFormula | null {
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch {
    return null;
  }
  if (tokens.length === 0) return null;
  const parser = new Parser(tokens);
  let root: FormulaNode;
  try {
    root = parser.parse();
  } catch {
    return null;
  }
  return { root, nodeCount: parser.nodeCount, cellsCovered: parser.cellsCovered, refs: parser.refs };
}

/** Rewrites sheet-qualified references from `oldName` to `newName`, keeping everything else byte-identical. */
export function rewriteSheetNameInFormula(body: string, oldName: string, newName: string): string {
  let out = '';
  let i = 0;
  const lowerOld = oldName.toLowerCase();
  while (i < body.length) {
    const rest = body.slice(i);
    if (body[i] === '"') {
      let j = i + 1;
      while (j < body.length) {
        if (body[j] === '"') {
          if (body[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += body.slice(i, j);
      i = j;
      continue;
    }
    const sheet = SHEET_PREFIX_RE.exec(rest);
    if (sheet) {
      const name = sheet[1] !== undefined ? sheet[1] : sheet[2];
      const local = readLocalRef(rest.slice(sheet[0].length), name);
      if (local) {
        const localText = rest.slice(sheet[0].length, sheet[0].length + local.length);
        const replacement = name.toLowerCase() === lowerOld ? newName : name;
        const quoted = /^[A-Za-z0-9_]+$/.test(replacement) && /^[A-Za-z_]/.test(replacement)
          ? replacement
          : `'${replacement}'`;
        out += `${quoted}!${localText}`;
        i += sheet[0].length + local.length;
        continue;
      }
    }
    out += body[i];
    i++;
  }
  return out;
}
