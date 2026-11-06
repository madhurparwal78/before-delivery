// Formula parser with the parse-node and cells-covered budgets (Business rules · Budgets).
import { LIMITS } from "../limits.js";
import { type Area } from "../refs.js";
import { type CellPart, type Token, tokenize } from "./lexer.js";

export interface RefNode {
  t: "ref";
  sheet: string | null; // the sheet name as written; null means the formula's own sheet
  area: Area;
  kind: "cell" | "range" | "column";
  inGrid: boolean;
}

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | RefNode
  | { t: "unary"; op: "-" | "+"; a: Node }
  | { t: "binary"; op: string; a: Node; b: Node }
  | { t: "call"; name: string; args: Node[] }
  | { t: "name"; name: string };

export type Parsed =
  | { ok: true; ast: Node; nodes: number; cover: number; refs: RefNode[] }
  | { ok: false; refs: RefNode[] };

const COMPARE = new Set(["=", "<>", "<", "<=", ">", ">="]);

class Syntax extends Error {}

function areaOf(a: CellPart, b: CellPart): Area {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

function inGrid(area: Area): boolean {
  return area.top >= 1 && area.left >= 1 && area.bottom <= LIMITS.maxRows && area.right <= LIMITS.maxColumns;
}

class Parser {
  private pos = 0;
  nodes = 0;
  cover = 0;
  refs: RefNode[] = [];

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(v: string): boolean {
    const tok = this.peek();
    return tok?.t === "op" && tok.v === v;
  }

  private expect(v: string): void {
    if (!this.isOp(v)) throw new Syntax();
    this.pos++;
  }

  private node<T extends Node>(n: T): T {
    this.nodes++;
    return n;
  }

  parse(): Node {
    const ast = this.comparison();
    if (this.pos !== this.tokens.length) throw new Syntax();
    return ast;
  }

  private binaryLevel(next: () => Node, accepts: (op: string) => boolean): Node {
    let left = next();
    for (let tok = this.peek(); tok?.t === "op" && accepts(tok.v); tok = this.peek()) {
      this.pos++;
      const right = next();
      left = this.node({ t: "binary", op: tok.v, a: left, b: right });
    }
    return left;
  }

  private comparison(): Node {
    return this.binaryLevel(() => this.concat(), (op) => COMPARE.has(op));
  }

  private concat(): Node {
    return this.binaryLevel(() => this.additive(), (op) => op === "&");
  }

  private additive(): Node {
    return this.binaryLevel(() => this.multiplicative(), (op) => op === "+" || op === "-");
  }

  private multiplicative(): Node {
    return this.binaryLevel(() => this.power(), (op) => op === "*" || op === "/");
  }

  private power(): Node {
    return this.binaryLevel(() => this.unary(), (op) => op === "^");
  }

  private unary(): Node {
    const tok = this.peek();
    if (tok?.t === "op" && (tok.v === "-" || tok.v === "+")) {
      this.pos++;
      const a = this.unary();
      return this.node({ t: "unary", op: tok.v, a });
    }
    return this.primary();
  }

  private reference(sheet: string | null): Node {
    const tok = this.peek();
    let ref: RefNode;
    if (tok?.t === "cell") {
      const area = areaOf(tok.a, tok.a);
      ref = { t: "ref", sheet, area, kind: "cell", inGrid: inGrid(area) };
      this.cover += 1;
    } else if (tok?.t === "range") {
      const area = areaOf(tok.a, tok.b);
      ref = { t: "ref", sheet, area, kind: "range", inGrid: inGrid(area) };
      this.cover += (area.bottom - area.top + 1) * (area.right - area.left + 1);
    } else if (tok?.t === "cols") {
      const area = { ...areaOf(tok.a, tok.b), top: 1, bottom: LIMITS.maxRows };
      ref = { t: "ref", sheet, area, kind: "column", inGrid: inGrid(area) };
      this.cover += (area.right - area.left + 1) * LIMITS.maxRows;
    } else {
      throw new Syntax();
    }
    this.pos++;
    this.refs.push(ref);
    return this.node(ref);
  }

  private primary(): Node {
    const tok = this.peek();
    if (!tok) throw new Syntax();
    switch (tok.t) {
      case "num":
        this.pos++;
        return this.node({ t: "num", v: tok.v });
      case "str":
        this.pos++;
        return this.node({ t: "str", v: tok.v });
      case "sheet":
        this.pos++;
        return this.reference(tok.name);
      case "cell":
      case "range":
      case "cols":
        return this.reference(null);
      case "ident": {
        this.pos++;
        const name = tok.v.toUpperCase();
        if (this.isOp("(")) {
          this.pos++;
          const args: Node[] = [];
          if (!this.isOp(")")) {
            args.push(this.comparison());
            while (this.isOp(",")) {
              this.pos++;
              args.push(this.comparison());
            }
          }
          this.expect(")");
          return this.node({ t: "call", name, args });
        }
        if (name === "TRUE" || name === "FALSE") return this.node({ t: "bool", v: name === "TRUE" });
        return this.node({ t: "name", name });
      }
      case "op":
        if (tok.v === "(") {
          this.pos++;
          const inner = this.comparison();
          this.expect(")");
          return inner;
        }
        throw new Syntax();
    }
  }
}

/** Parses a formula body (the input without its leading "="). */
export function parseFormula(source: string): Parsed {
  const tokens = tokenize(source);
  if (!tokens || tokens.length === 0) return { ok: false, refs: [] };
  const parser = new Parser(tokens);
  try {
    const ast = parser.parse();
    return { ok: true, ast, nodes: parser.nodes, cover: parser.cover, refs: parser.refs };
  } catch (error) {
    if (error instanceof Syntax) return { ok: false, refs: [] };
    throw error;
  }
}
