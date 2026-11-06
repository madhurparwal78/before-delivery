/**
 * Session search: the published query grammar. The parser walks the input
 * character by character; it never applies a backtracking regular expression
 * to user input.
 *
 * query   = or
 * or      = and ( "OR" and )*
 * and     = unary ( [ "AND" ] unary )*
 * unary   = "-" unary | primary
 * primary = term | phrase | "(" or ")"
 *
 * A malformed query is never refused. It is repaired by the published rules,
 * and a query that repairs to nothing matches every session.
 */

export type Query =
  | { kind: 'or'; parts: Query[] }
  | { kind: 'and'; parts: Query[] }
  | { kind: 'not'; inner: Query }
  | { kind: 'match'; text: string; phrase: boolean }
  | { kind: 'all' };

type TokenKind = 'term' | 'phrase' | 'lparen' | 'rparen' | 'or' | 'and' | 'not';
interface Token {
  kind: TokenKind;
  text: string;
}

/** Whitespace separates tokens. */
function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}

/** Lex the query into tokens, marking negations and phrases. */
function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (isWs(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ kind: c === '(' ? 'lparen' : 'rparen', text: c });
      i++;
      continue;
    }
    if (c === '"') {
      const phrase = lexPhrase(src, i + 1);
      tokens.push({ kind: 'phrase', text: phrase.text });
      i = phrase.next;
      continue;
    }
    if (c === '-') {
      // A `-` directly in front of a term, a phrase or `(` negates it.
      const next = src[i + 1];
      if (next !== undefined && !isWs(next) && next !== ')') {
        tokens.push({ kind: 'not', text: '-' });
        i++;
        continue;
      }
      // A `-` that negates nothing is dropped.
      i++;
      continue;
    }
    // A term is a maximal run of other characters.
    let term = '';
    while (i < src.length) {
      const ch = src[i]!;
      if (isWs(ch) || ch === '(' || ch === ')' || ch === '"') break;
      term += ch;
      i++;
    }
    if (term.startsWith('-')) {
      tokens.push({ kind: 'not', text: '-' });
      pushTerm(tokens, term.slice(1));
      continue;
    }
    pushTerm(tokens, term);
  }
  return tokens;
}

/** A term, or the operator it spells. */
function pushTerm(tokens: Token[], term: string): void {
  if (term === 'AND') tokens.push({ kind: 'and', text: term });
  else if (term === 'OR') tokens.push({ kind: 'or', text: term });
  else tokens.push({ kind: 'term', text: term });
}

/** A phrase ends at the next unescaped quote, or at the end of the input. */
function lexPhrase(src: string, from: number): { text: string; next: number } {
  let text = '';
  let i = from;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length && (src[i + 1] === '"' || src[i + 1] === '\\')) {
      text += src[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === '"') return { text, next: i + 1 };
    text += ch;
    i++;
  }
  return { text, next: i };
}

/**
 * Repair a token stream by the published recovery rules:
 * 1. an empty phrase and an empty group are dropped, together with a `-` that
 *    negated them;
 * 2. a `)` with no open group is dropped;
 * 3. operators at the start of the query or of a group, at the end, or
 *    directly before `)` are dropped; of two or more operators in a row, only
 *    the last is kept;
 * 4. a `-` that negates nothing is dropped.
 */
function repair(tokens: Token[]): Token[] {
  let out = tokens.slice();

  // Empty phrases and groups go first, with the `-` that negated them.
  out = dropEmpty(out);

  // A `)` with no open group is dropped.
  let depth = 0;
  out = out.filter((t) => {
    if (t.kind === 'lparen') depth++;
    else if (t.kind === 'rparen') {
      if (depth === 0) return false;
      depth--;
    }
    return true;
  });

  out = collapseOperatorRuns(out);
  out = dropStrayOperators(out);
  out = dropDanglingNot(out);
  return out;
}

/** Drop empty phrases and `()` groups, with the `-` that negated them. */
function dropEmpty(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'phrase' && t.text === '') {
      if (out.length > 0 && out[out.length - 1]!.kind === 'not') out.pop();
      continue;
    }
    if (t.kind === 'lparen' && tokens[i + 1]?.kind === 'rparen') {
      if (out.length > 0 && out[out.length - 1]!.kind === 'not') out.pop();
      i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

/** Of two or more operators in a row, keep only the last. */
function collapseOperatorRuns(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.kind === 'or' || t.kind === 'and') {
      let j = i;
      while (j < tokens.length && (tokens[j]!.kind === 'or' || tokens[j]!.kind === 'and')) j++;
      out.push(tokens[j - 1]!);
      i = j;
      continue;
    }
    out.push(t);
    i++;
  }
  return out;
}

/** Drop operators at the start, at the end and directly before `)`. */
function dropStrayOperators(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'or' && t.kind !== 'and') {
      out.push(t);
      continue;
    }
    const atStart = out.length === 0 || out[out.length - 1]!.kind === 'lparen';
    const next = tokens[i + 1];
    const atEnd = next === undefined;
    const beforeRparen = next?.kind === 'rparen';
    if (atStart || atEnd || beforeRparen) continue;
    out.push(t);
  }
  return out;
}

/** A `-` whose next token is `)` or the end of the stream negates nothing. */
function dropDanglingNot(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'not' && (i + 1 >= tokens.length || tokens[i + 1]!.kind === 'rparen')) {
      continue;
    }
    out.push(t);
  }
  return out;
}

interface ParseState {
  tokens: Token[];
  pos: number;
}

/** Parse `or` from the current position. */
function parseOr(s: ParseState): Query {
  const parts: Query[] = [parseAnd(s)];
  while (s.pos < s.tokens.length && s.tokens[s.pos]!.kind === 'or') {
    s.pos++;
    parts.push(parseAnd(s));
  }
  return parts.length === 1 ? parts[0]! : { kind: 'or', parts };
}

/** Parse `and` from the current position. */
function parseAnd(s: ParseState): Query {
  const parts: Query[] = [parseUnary(s)];
  while (s.pos < s.tokens.length) {
    const t = s.tokens[s.pos]!;
    if (t.kind === 'and') {
      s.pos++;
      parts.push(parseUnary(s));
      continue;
    }
    // Two items side by side mean AND; an `OR`, a `)` or the end ends this level.
    if (t.kind === 'or' || t.kind === 'rparen') break;
    parts.push(parseUnary(s));
  }
  return parts.length === 1 ? parts[0]! : { kind: 'and', parts };
}

/** Parse `unary`: negation binds tightest. */
function parseUnary(s: ParseState): Query {
  const t = s.tokens[s.pos]!;
  if (t && t.kind === 'not') {
    s.pos++;
    return { kind: 'not', inner: parseUnary(s) };
  }
  return parsePrimary(s);
}

/** Parse `primary`: a term, a phrase or a parenthesised group. */
function parsePrimary(s: ParseState): Query {
  const t = s.tokens[s.pos]!;
  if (!t) return { kind: 'all' };
  if (t.kind === 'lparen') {
    s.pos++;
    const inner = parseOr(s);
    // A `(` left open closes at the end of the input.
    if (s.pos < s.tokens.length && s.tokens[s.pos]!.kind === 'rparen') s.pos++;
    return inner;
  }
  s.pos++;
  return t.kind === 'phrase'
    ? { kind: 'match', text: t.text, phrase: true }
    : { kind: 'match', text: t.text, phrase: false };
}

/**
 * Parse a query into its matching tree. Malformed input is repaired, never
 * refused; a query that repairs to nothing matches every session.
 */
export function parseQuery(src: string): Query {
  const tokens = repair(lex(src));
  if (tokens.length === 0) return { kind: 'all' };
  const s: ParseState = { tokens, pos: 0 };
  return parseOr(s);
}

/** Does a query match a set of text fields? Both sides are folded. */
export function queryMatches(q: Query, rawFields: string[]): boolean {
  const fields = rawFields.map(foldText);
  return matches(q, fields);
}

function matches(q: Query, fields: string[]): boolean {
  switch (q.kind) {
    case 'all':
      return true;
    case 'match':
      return fields.some((f) => f.includes(foldText(q.text)));
    case 'not':
      return !matches(q.inner, fields);
    case 'and':
      return q.parts.every((p) => matches(p, fields));
    case 'or':
      return q.parts.some((p) => matches(p, fields));
  }
}

/** Fold text: NFD, strip combining marks, lower-case, single spaces. */
export function foldText(s: string): string {
  let stripped = '';
  for (const ch of s.normalize('NFD')) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0x0300 && c <= 0x036f) ||
      (c >= 0x1ab0 && c <= 0x1aff) ||
      (c >= 0x20d0 && c <= 0x20ff) ||
      (c >= 0xfe20 && c <= 0xfe2f)
    ) {
      continue;
    }
    stripped += ch;
  }
  return stripped.toLowerCase().replace(/\s+/g, ' ').trim();
}
