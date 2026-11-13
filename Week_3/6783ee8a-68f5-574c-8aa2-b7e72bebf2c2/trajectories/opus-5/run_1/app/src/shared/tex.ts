/**
 * The TeX subset Brackenpad renders, turned into MathML. TeX that this cannot
 * parse returns null, and the caller renders the source text instead.
 */

const SYMBOLS: Record<string, { text: string; kind: 'mi' | 'mo' | 'mn' }> = {
  alpha: { text: 'α', kind: 'mi' },
  beta: { text: 'β', kind: 'mi' },
  gamma: { text: 'γ', kind: 'mi' },
  delta: { text: 'δ', kind: 'mi' },
  epsilon: { text: 'ε', kind: 'mi' },
  zeta: { text: 'ζ', kind: 'mi' },
  eta: { text: 'η', kind: 'mi' },
  theta: { text: 'θ', kind: 'mi' },
  iota: { text: 'ι', kind: 'mi' },
  kappa: { text: 'κ', kind: 'mi' },
  lambda: { text: 'λ', kind: 'mi' },
  mu: { text: 'μ', kind: 'mi' },
  nu: { text: 'ν', kind: 'mi' },
  xi: { text: 'ξ', kind: 'mi' },
  pi: { text: 'π', kind: 'mi' },
  rho: { text: 'ρ', kind: 'mi' },
  sigma: { text: 'σ', kind: 'mi' },
  tau: { text: 'τ', kind: 'mi' },
  upsilon: { text: 'υ', kind: 'mi' },
  phi: { text: 'φ', kind: 'mi' },
  chi: { text: 'χ', kind: 'mi' },
  psi: { text: 'ψ', kind: 'mi' },
  omega: { text: 'ω', kind: 'mi' },
  Gamma: { text: 'Γ', kind: 'mi' },
  Delta: { text: 'Δ', kind: 'mi' },
  Theta: { text: 'Θ', kind: 'mi' },
  Lambda: { text: 'Λ', kind: 'mi' },
  Xi: { text: 'Ξ', kind: 'mi' },
  Pi: { text: 'Π', kind: 'mi' },
  Sigma: { text: 'Σ', kind: 'mi' },
  Phi: { text: 'Φ', kind: 'mi' },
  Psi: { text: 'Ψ', kind: 'mi' },
  Omega: { text: 'Ω', kind: 'mi' },
  infty: { text: '∞', kind: 'mi' },
  sum: { text: '∑', kind: 'mo' },
  prod: { text: '∏', kind: 'mo' },
  int: { text: '∫', kind: 'mo' },
  pm: { text: '±', kind: 'mo' },
  mp: { text: '∓', kind: 'mo' },
  times: { text: '×', kind: 'mo' },
  div: { text: '÷', kind: 'mo' },
  cdot: { text: '⋅', kind: 'mo' },
  cdots: { text: '⋯', kind: 'mo' },
  ldots: { text: '…', kind: 'mo' },
  le: { text: '≤', kind: 'mo' },
  leq: { text: '≤', kind: 'mo' },
  ge: { text: '≥', kind: 'mo' },
  geq: { text: '≥', kind: 'mo' },
  ne: { text: '≠', kind: 'mo' },
  neq: { text: '≠', kind: 'mo' },
  approx: { text: '≈', kind: 'mo' },
  equiv: { text: '≡', kind: 'mo' },
  sim: { text: '∼', kind: 'mo' },
  propto: { text: '∝', kind: 'mo' },
  in: { text: '∈', kind: 'mo' },
  notin: { text: '∉', kind: 'mo' },
  subset: { text: '⊂', kind: 'mo' },
  supset: { text: '⊃', kind: 'mo' },
  cup: { text: '∪', kind: 'mo' },
  cap: { text: '∩', kind: 'mo' },
  to: { text: '→', kind: 'mo' },
  rightarrow: { text: '→', kind: 'mo' },
  leftarrow: { text: '←', kind: 'mo' },
  Rightarrow: { text: '⇒', kind: 'mo' },
  Leftarrow: { text: '⇐', kind: 'mo' },
  partial: { text: '∂', kind: 'mo' },
  nabla: { text: '∇', kind: 'mo' },
  forall: { text: '∀', kind: 'mo' },
  exists: { text: '∃', kind: 'mo' },
  neg: { text: '¬', kind: 'mo' },
  wedge: { text: '∧', kind: 'mo' },
  vee: { text: '∨', kind: 'mo' },
  sqrt: { text: '√', kind: 'mo' },
};

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'min', 'max', 'lim', 'det', 'gcd',
]);

const OPERATOR_CHARS = new Set(['+', '-', '=', '<', '>', '(', ')', '[', ']', ',', ';', ':', '!', '*', '/', '|', '.', "'"]);

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class TexParseError extends Error {}

class TexParser {
  private readonly src: string;
  private pos = 0;

  constructor(src: string) {
    this.src = src;
  }

  parse(): string {
    const nodes = this.parseGroupBody(null);
    if (this.pos < this.src.length) throw new TexParseError('unparsed input');
    return nodes;
  }

  /** Reads nodes until the closing brace (or end when stop is null). */
  private parseGroupBody(stop: '}' | null): string {
    const parts: string[] = [];
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.src.length) {
        if (stop) throw new TexParseError('unclosed group');
        break;
      }
      const ch = this.src[this.pos];
      if (ch === '}') {
        if (stop === '}') break;
        throw new TexParseError('unexpected }');
      }
      const atom = this.parseScripted();
      parts.push(atom);
    }
    return parts.join('');
  }

  private skipSpace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos += 1;
  }

  private parseScripted(): string {
    let base = this.parseAtom();
    for (;;) {
      this.skipSpace();
      const ch = this.src[this.pos];
      if (ch === '^') {
        this.pos += 1;
        const sup = this.parseAtom();
        this.skipSpace();
        if (this.src[this.pos] === '_') {
          this.pos += 1;
          const sub = this.parseAtom();
          base = `<msubsup>${base}${sub}${sup}</msubsup>`;
        } else {
          base = `<msup>${base}${sup}</msup>`;
        }
      } else if (ch === '_') {
        this.pos += 1;
        const sub = this.parseAtom();
        this.skipSpace();
        if (this.src[this.pos] === '^') {
          this.pos += 1;
          const sup = this.parseAtom();
          base = `<msubsup>${base}${sub}${sup}</msubsup>`;
        } else {
          base = `<msub>${base}${sub}</msub>`;
        }
      } else {
        return base;
      }
    }
  }

  private parseAtom(): string {
    this.skipSpace();
    if (this.pos >= this.src.length) throw new TexParseError('unexpected end');
    const ch = this.src[this.pos];
    if (ch === '{') {
      this.pos += 1;
      const body = this.parseGroupBody('}');
      if (this.src[this.pos] !== '}') throw new TexParseError('unclosed group');
      this.pos += 1;
      return `<mrow>${body}</mrow>`;
    }
    if (ch === '\\') return this.parseCommand();
    if (/[0-9]/.test(ch)) {
      const match = /^[0-9]+(?:\.[0-9]+)?/.exec(this.src.slice(this.pos));
      if (!match) throw new TexParseError('bad number');
      this.pos += match[0].length;
      return `<mn>${match[0]}</mn>`;
    }
    if (/[A-Za-z]/.test(ch)) {
      this.pos += 1;
      return `<mi>${escapeText(ch)}</mi>`;
    }
    if (OPERATOR_CHARS.has(ch)) {
      this.pos += 1;
      return `<mo>${escapeText(ch)}</mo>`;
    }
    throw new TexParseError(`unsupported character ${ch}`);
  }

  private parseCommand(): string {
    const match = /^\\([A-Za-z]+|[\\{}$%&_#,; ])/.exec(this.src.slice(this.pos));
    if (!match) throw new TexParseError('bad command');
    this.pos += match[0].length;
    const name = match[1];
    if (name === ',' || name === ';' || name === ' ') return '<mspace width="0.2em"></mspace>';
    if (name === '\\') throw new TexParseError('line breaks are not supported');
    if (name === '{' || name === '}' || name === '$' || name === '%' || name === '&' || name === '_' || name === '#') {
      return `<mo>${escapeText(name)}</mo>`;
    }
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const num = this.parseAtom();
      const den = this.parseAtom();
      return `<mfrac>${num}${den}</mfrac>`;
    }
    if (name === 'sqrt') {
      this.skipSpace();
      if (this.src[this.pos] === '[') {
        const close = this.src.indexOf(']', this.pos);
        if (close < 0) throw new TexParseError('unclosed root index');
        const indexSrc = this.src.slice(this.pos + 1, close);
        this.pos = close + 1;
        const index = parseFragment(indexSrc);
        const body = this.parseAtom();
        return `<mroot>${body}${index}</mroot>`;
      }
      const body = this.parseAtom();
      return `<msqrt>${body}</msqrt>`;
    }
    if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
      this.skipSpace();
      if (this.src[this.pos] !== '{') throw new TexParseError('missing text body');
      const close = this.src.indexOf('}', this.pos);
      if (close < 0) throw new TexParseError('unclosed text body');
      const body = this.src.slice(this.pos + 1, close);
      this.pos = close + 1;
      return `<mtext>${escapeText(body)}</mtext>`;
    }
    if (name === 'left' || name === 'right') {
      this.skipSpace();
      const delim = this.src[this.pos];
      if (delim === undefined) throw new TexParseError('missing delimiter');
      this.pos += 1;
      if (delim === '\\') {
        const cmd = /^([A-Za-z]+)/.exec(this.src.slice(this.pos));
        if (!cmd) throw new TexParseError('bad delimiter');
        this.pos += cmd[1].length;
        const symbol = SYMBOLS[cmd[1]];
        if (!symbol) throw new TexParseError('unknown delimiter');
        return `<mo>${escapeText(symbol.text)}</mo>`;
      }
      if (delim === '.') return '';
      return `<mo>${escapeText(delim)}</mo>`;
    }
    if (FUNCTIONS.has(name)) return `<mi>${name}</mi>`;
    const symbol = SYMBOLS[name];
    if (symbol) return `<${symbol.kind}>${escapeText(symbol.text)}</${symbol.kind}>`;
    throw new TexParseError(`unknown command ${name}`);
  }
}

function parseFragment(src: string): string {
  return new TexParser(src).parse();
}

/**
 * Returns the MathML for this TeX, or null when the TeX cannot be parsed.
 * The TeX source is kept as the formula's annotation.
 */
export function texToMathML(tex: string, display: boolean): string | null {
  let body: string;
  try {
    body = parseFragment(tex);
  } catch (error) {
    if (error instanceof TexParseError) return null;
    throw error;
  }
  if (body === '') return null;
  const displayAttr = display ? ' display="block"' : '';
  return (
    `<math xmlns="http://www.w3.org/1998/Math/MathML"${displayAttr}><semantics><mrow>${body}</mrow>` +
    `<annotation encoding="application/x-tex">${escapeText(tex)}</annotation></semantics></math>`
  );
}
