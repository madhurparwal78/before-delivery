// Session search: the published query grammar, its recovery rules and its matching, walked
// character by character. No regular expression ever runs over the query.
//
//   query   = or
//   or      = and ( "OR" and )*
//   and     = unary ( [ "AND" ] unary )*
//   unary   = "-" unary | primary
//   primary = term | phrase | "(" or ")"

type Token =
  | { kind: 'term'; text: string }
  | { kind: 'phrase'; text: string }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'not' }
  | { kind: 'and' }
  | { kind: 'or' };

type Query =
  | { kind: 'text'; text: string }
  | { kind: 'not'; operand: Query }
  | { kind: 'and' | 'or'; left: Query; right: Query };

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v', ' ', ' ', ' ', '　']);

function isSpace(char: string): boolean {
  return WHITESPACE.has(char) || (char >= ' ' && char <= ' ');
}

// Tested one code point at a time, never against the whole query.
const COMBINING_MARK = /^\p{M}$/u;

// Folds text for comparison: NFD, combining marks removed, lower case, whitespace runs as one space.
export function fold(text: string): string {
  let out = '';
  let pendingSpace = false;
  for (const char of text.normalize('NFD')) {
    if (isSpace(char)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (COMBINING_MARK.test(char)) continue;
    if (pendingSpace) out += ' ';
    pendingSpace = false;
    out += char.toLowerCase();
  }
  return out;
}

function isTermChar(char: string): boolean {
  return !isSpace(char) && char !== '(' && char !== ')' && char !== '"';
}

function tokenize(input: string): Token[] {
  const chars = Array.from(input);
  const tokens: Token[] = [];
  let i = 0;
  const readPhrase = (): void => {
    let text = '';
    i += 1;
    while (i < chars.length) {
      const char = chars[i] ?? '';
      if (char === '\\' && (chars[i + 1] === '"' || chars[i + 1] === '\\')) {
        text += chars[i + 1];
        i += 2;
      } else if (char === '"') {
        i += 1;
        break;
      } else {
        text += char;
        i += 1;
      }
    }
    tokens.push({ kind: 'phrase', text });
  };
  while (i < chars.length) {
    const char = chars[i] ?? '';
    if (isSpace(char)) {
      i += 1;
    } else if (char === '(') {
      tokens.push({ kind: 'open' });
      i += 1;
    } else if (char === ')') {
      tokens.push({ kind: 'close' });
      i += 1;
    } else if (char === '"') {
      readPhrase();
    } else {
      let word = '';
      while (i < chars.length && isTermChar(chars[i] ?? '')) {
        word += chars[i];
        i += 1;
      }
      if (word.startsWith('-')) {
        const rest = word.slice(1);
        if (rest !== '') tokens.push({ kind: 'not' }, { kind: 'term', text: rest });
        else if (chars[i] === '(' || chars[i] === '"') tokens.push({ kind: 'not' });
      } else if (word === 'AND') {
        tokens.push({ kind: 'and' });
      } else if (word === 'OR') {
        tokens.push({ kind: 'or' });
      } else {
        tokens.push({ kind: 'term', text: word });
      }
    }
  }
  return tokens;
}

// Recovery steps 2 to 5 of the published rules (step 1, the open phrase, ends in tokenize).
function repair(tokens: Token[]): Token[] {
  // Close every open group at the end; drop a ")" with no open group.
  const balanced: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'close') {
      if (depth === 0) continue;
      depth -= 1;
    } else if (token.kind === 'open') {
      depth += 1;
    }
    balanced.push(token);
  }
  for (; depth > 0; depth -= 1) balanced.push({ kind: 'close' });

  // Drop empty phrases and empty groups with the "-" that negated them.
  const pruned: Token[] = [];
  const dropNegation = (): void => {
    if (pruned.at(-1)?.kind === 'not') pruned.pop();
  };
  for (const token of balanced) {
    if (token.kind === 'phrase' && fold(token.text) === '') {
      dropNegation();
    } else if (token.kind === 'close' && pruned.at(-1)?.kind === 'open') {
      pruned.pop();
      dropNegation();
    } else {
      pruned.push(token);
    }
  }
  // A "-" that negates nothing is dropped.
  const negated = pruned.filter(
    (token, index) => token.kind !== 'not' || ['term', 'phrase', 'open'].includes(pruned[index + 1]?.kind ?? ''),
  );

  // Operators at the start, at the end, after "(" or before ")" are dropped; of a run, only the last stays.
  const out: Token[] = [];
  negated.forEach((token, index) => {
    if (token.kind !== 'and' && token.kind !== 'or') {
      out.push(token);
      return;
    }
    const next = negated[index + 1]?.kind;
    const previous = out.at(-1)?.kind;
    if (next === undefined || next === 'close' || next === 'and' || next === 'or') return;
    if (previous === undefined || previous === 'open') return;
    out.push(token);
  });
  return out;
}

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  parseOr(): Query | null {
    let left = this.parseAnd();
    while (this.peek()?.kind === 'or') {
      this.position += 1;
      left = combine('or', left, this.parseAnd());
    }
    return left;
  }

  private parseAnd(): Query | null {
    let left = this.parseUnary();
    for (;;) {
      const next = this.peek();
      if (next === undefined || next.kind === 'or' || next.kind === 'close') return left;
      if (next.kind === 'and') this.position += 1;
      left = combine('and', left, this.parseUnary());
    }
  }

  private parseUnary(): Query | null {
    const token = this.peek();
    if (token?.kind === 'not') {
      this.position += 1;
      const operand = this.parseUnary();
      return operand === null ? null : { kind: 'not', operand };
    }
    return this.parsePrimary();
  }

  // An empty group left by recovery yields nothing and consumes nothing but its own brackets.
  private parsePrimary(): Query | null {
    const token = this.peek();
    if (token?.kind === 'term' || token?.kind === 'phrase') {
      this.position += 1;
      return { kind: 'text', text: fold(token.text) };
    }
    if (token?.kind !== 'open') return null;
    this.position += 1;
    const inner = this.parseOr();
    if (this.peek()?.kind === 'close') this.position += 1;
    return inner;
  }
}

// An operand that recovery emptied is simply left out.
function combine(kind: 'and' | 'or', left: Query | null, right: Query | null): Query | null {
  if (left === null) return right;
  if (right === null) return left;
  return { kind, left, right };
}

// Parses a search; null means the query matches every session.
export function parseQuery(input: string): Query | null {
  return new Parser(repair(tokenize(input))).parseOr();
}

// Matches against the folded searchable fields of one session: title, speaker names, companies.
// A term or phrase matches when it sits inside a single field.
export function matches(query: Query | null, fields: string[]): boolean {
  if (query === null) return true;
  switch (query.kind) {
    case 'text':
      return fields.some((field) => field.includes(query.text));
    case 'not':
      return !matches(query.operand, fields);
    case 'and':
      return matches(query.left, fields) && matches(query.right, fields);
    case 'or':
      return matches(query.left, fields) || matches(query.right, fields);
  }
}
