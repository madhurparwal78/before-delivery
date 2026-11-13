// The `if` expressions of `rules`.
class ExpressionError extends Error {}

type Vars = Readonly<Record<string, string>>;

class ExpressionReader {
  private readonly src: string;
  private readonly vars: Vars;
  private pos = 0;

  constructor(src: string, vars: Vars) {
    this.src = src;
    this.vars = vars;
  }

  evaluate(): boolean {
    const value = this.readOr();
    this.skipSpace();
    if (this.pos < this.src.length) throw new ExpressionError();
    return value;
  }

  private skipSpace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src.charAt(this.pos))) this.pos++;
  }

  private accept(token: string): boolean {
    this.skipSpace();
    if (!this.src.startsWith(token, this.pos)) return false;
    this.pos += token.length;
    return true;
  }

  private readOr(): boolean {
    let value = this.readAnd();
    while (this.accept("||")) {
      const right = this.readAnd();
      value = value || right;
    }
    return value;
  }

  private readAnd(): boolean {
    let value = this.readTerm();
    while (this.accept("&&")) {
      const right = this.readTerm();
      value = value && right;
    }
    return value;
  }

  private readTerm(): boolean {
    if (this.accept("(")) {
      const inner = this.readOr();
      if (!this.accept(")")) throw new ExpressionError();
      return inner;
    }
    const left = this.readOperand();
    if (this.accept("==")) return left === this.readOperand();
    if (this.accept("!=")) return left !== this.readOperand();
    if (this.accept("=~")) return this.readPattern().test(left);
    return left !== "";
  }

  private readOperand(): string {
    this.skipSpace();
    const char = this.src.charAt(this.pos);
    if (char === '"' || char === "'") return this.readString(char);
    const match = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(this.src.slice(this.pos));
    if (!match) throw new ExpressionError();
    this.pos += match[0].length;
    const name = match[1] ?? match[2] ?? "";
    return Object.hasOwn(this.vars, name) ? (this.vars[name] ?? "") : "";
  }

  private readString(quote: string): string {
    let value = "";
    for (let i = this.pos + 1; i < this.src.length; i++) {
      const char = this.src.charAt(i);
      if (char === "\\" && i + 1 < this.src.length) {
        i++;
        value += this.src.charAt(i);
      } else if (char === quote) {
        this.pos = i + 1;
        return value;
      } else {
        value += char;
      }
    }
    throw new ExpressionError();
  }

  private readPattern(): RegExp {
    this.skipSpace();
    if (this.src.charAt(this.pos) !== "/") throw new ExpressionError();
    let body = "";
    let i = this.pos + 1;
    for (; i < this.src.length && this.src.charAt(i) !== "/"; i++) {
      if (this.src.charAt(i) === "\\" && i + 1 < this.src.length) {
        body += this.src.charAt(i);
        i++;
      }
      body += this.src.charAt(i);
    }
    if (i >= this.src.length) throw new ExpressionError();
    const flags = /^[A-Za-z]*/.exec(this.src.slice(i + 1))?.[0] ?? "";
    this.pos = i + 1 + flags.length;
    if (flags !== "" && flags !== "i") throw new ExpressionError();
    try {
      return new RegExp(body, flags);
    } catch {
      throw new ExpressionError();
    }
  }
}

// An expression that cannot be read matches nothing.
export function evaluateIf(expr: string, vars: Vars): boolean {
  try {
    return new ExpressionReader(expr, vars).evaluate();
  } catch (error) {
    if (error instanceof ExpressionError) return false;
    throw error;
  }
}
