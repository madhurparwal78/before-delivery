// Speaker bios: the published CommonMark subset rendered to inline HTML. The renderer walks the
// bio once, left to right (code spans and autolinks first, then link brackets), and then resolves
// emphasis with CommonMark's delimiter-run algorithm. It can only ever emit em, strong, code, br
// and a with an http(s) href; everything else is escaped text.

type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'html'; html: string }
  | Delimiter
  | Bracket
  | { kind: 'em' | 'strong'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

interface Delimiter {
  kind: 'delimiter';
  char: '*' | '_';
  count: number;
  original: number;
  canOpen: boolean;
  canClose: boolean;
  order: number;
}

interface Bracket {
  kind: 'bracket';
  active: boolean;
  start: number;
  order: number;
}

function escapeHtml(text: string): string {
  let out = '';
  for (const char of text) {
    if (char === '&') out += '&amp;';
    else if (char === '<') out += '&lt;';
    else if (char === '>') out += '&gt;';
    else if (char === '"') out += '&quot;';
    else out += char;
  }
  return out;
}

const ASCII_PUNCTUATION = new Set(Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'));
// Each test sees one code point.
const UNICODE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
const UNICODE_SPACE = /^\s$/u;

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || UNICODE_SPACE.test(char);
}

function isPunctuation(char: string | undefined): boolean {
  return char !== undefined && UNICODE_PUNCTUATION.test(char);
}

function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}

function isSafeHref(destination: string): boolean {
  const lower = destination.toLowerCase();
  return (lower.startsWith('http://') && lower.length > 7) || (lower.startsWith('https://') && lower.length > 8);
}

function charBefore(chars: string[], index: number): string | undefined {
  return index > 0 ? chars[index - 1] : undefined;
}

class Renderer {
  private readonly chars: string[];
  private readonly nodes: Inline[] = [];
  private readonly delimiters: Delimiter[] = [];
  private readonly brackets: Bracket[] = [];
  private order = 0;
  private i = 0;

  constructor(source: string) {
    this.chars = Array.from(source.trim().replace(/\r\n?/g, '\n'));
  }

  render(): string {
    while (this.i < this.chars.length) this.step();
    this.processEmphasis(0);
    return serialise(this.nodes);
  }

  private text(text: string): void {
    const last = this.nodes.at(-1);
    if (last?.kind === 'text') last.text += text;
    else this.nodes.push({ kind: 'text', text });
  }

  private slice(from: number, to: number): string {
    return this.chars.slice(from, to).join('');
  }

  private step(): void {
    const char = this.chars[this.i] ?? '';
    if (char === '`') this.codeSpan();
    else if (char === '<') this.autolink();
    else if (char === '\\') this.backslash();
    else if (char === '\n') this.lineEnding(false);
    else if (char === '[') this.openBracket();
    else if (char === ']') this.closeBracket();
    else if (char === '*' || char === '_') this.delimiterRun(char);
    else {
      this.text(char);
      this.i += 1;
    }
  }

  private runLength(from: number, char: string): number {
    let end = from;
    while (this.chars[end] === char) end += 1;
    return end - from;
  }

  private codeSpan(): void {
    const length = this.runLength(this.i, '`');
    let search = this.i + length;
    while (search < this.chars.length) {
      if (this.chars[search] !== '`') {
        search += 1;
        continue;
      }
      const closing = this.runLength(search, '`');
      if (closing === length) {
        let content = this.slice(this.i + length, search).replace(/\n/g, ' ');
        if (content.length >= 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') {
          content = content.slice(1, -1);
        }
        this.nodes.push({ kind: 'html', html: `<code>${escapeHtml(content)}</code>` });
        this.i = search + closing;
        return;
      }
      search += closing;
    }
    this.text('`'.repeat(length));
    this.i += length;
  }

  // <scheme:...> where the scheme is 2 to 32 letters, digits, "+", "." or "-", starting with a letter.
  private autolink(): void {
    let j = this.i + 1;
    const first = this.chars[j] ?? '';
    if (/^[A-Za-z]$/.test(first)) {
      j += 1;
      while (j < this.chars.length && /^[A-Za-z0-9+.-]$/.test(this.chars[j] ?? '')) j += 1;
      const schemeLength = j - this.i - 1;
      if (schemeLength >= 2 && schemeLength <= 32 && this.chars[j] === ':') {
        j += 1;
        while (j < this.chars.length) {
          const char = this.chars[j] ?? '';
          if (char === '>' || char === '<' || isWhitespace(char) || isControl(char)) break;
          j += 1;
        }
        if (this.chars[j] === '>') {
          const url = this.slice(this.i + 1, j);
          const scheme = this.slice(this.i + 1, this.i + 1 + schemeLength).toLowerCase();
          if (scheme === 'http' || scheme === 'https') {
            this.nodes.push({ kind: 'link', href: url, children: [{ kind: 'text', text: url }] });
          } else {
            this.text(this.slice(this.i, j + 1));
          }
          this.i = j + 1;
          return;
        }
      }
    }
    this.text('<');
    this.i += 1;
  }

  private backslash(): void {
    const next = this.chars[this.i + 1];
    if (next === '\n') {
      this.i += 1;
      this.lineEnding(true);
    } else if (next !== undefined && ASCII_PUNCTUATION.has(next)) {
      this.text(next);
      this.i += 2;
    } else {
      this.text('\\');
      this.i += 1;
    }
  }

  // A line ending is one line feed; two trailing spaces or a backslash make it a hard break.
  // Spaces at the end and the start of each line are removed.
  private lineEnding(backslashBreak: boolean): void {
    const last = this.nodes.at(-1);
    let trailing = 0;
    if (last?.kind === 'text') {
      const stripped = last.text.replace(/ +$/, '');
      trailing = last.text.length - stripped.length;
      last.text = stripped;
    }
    const hard = backslashBreak || trailing >= 2;
    this.nodes.push({ kind: 'html', html: hard ? '<br>\n' : '\n' });
    this.i += 1;
    while (this.chars[this.i] === ' ') this.i += 1;
  }

  private delimiterRun(char: '*' | '_'): void {
    const length = this.runLength(this.i, char);
    const before = charBefore(this.chars, this.i);
    const after = this.chars[this.i + length];
    const leftFlanking =
      !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
    const rightFlanking =
      !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
    const canOpen = char === '*' ? leftFlanking : leftFlanking && (!rightFlanking || isPunctuation(before));
    const canClose = char === '*' ? rightFlanking : rightFlanking && (!leftFlanking || isPunctuation(after));
    const delimiter: Delimiter = {
      kind: 'delimiter',
      char,
      count: length,
      original: length,
      canOpen,
      canClose,
      order: this.order++,
    };
    this.nodes.push(delimiter);
    this.delimiters.push(delimiter);
    this.i += length;
  }

  private openBracket(): void {
    const bracket: Bracket = { kind: 'bracket', active: true, start: this.i, order: this.order++ };
    this.nodes.push(bracket);
    this.brackets.push(bracket);
    this.i += 1;
  }

  // ( destination ) with no whitespace or control characters and balanced parentheses.
  private destinationEnd(from: number): number | null {
    if (this.chars[from] !== '(') return null;
    let depth = 0;
    for (let j = from + 1; j < this.chars.length; j += 1) {
      const char = this.chars[j] ?? '';
      if (isWhitespace(char) || isControl(char)) return null;
      if (char === '\\' && ASCII_PUNCTUATION.has(this.chars[j + 1] ?? '')) j += 1;
      else if (char === '(') depth += 1;
      else if (char === ')') {
        if (depth === 0) return j;
        depth -= 1;
      }
    }
    return null;
  }

  private closeBracket(): void {
    const bracket = this.brackets.pop();
    const end = bracket?.active ? this.destinationEnd(this.i + 1) : null;
    if (bracket === undefined || end === null) {
      this.text(']');
      this.i += 1;
      return;
    }
    const at = this.nodes.indexOf(bracket);
    const destination = this.slice(this.i + 2, end);
    if (!isSafeHref(destination)) {
      // Not a link the subset allows: its source characters stay as plain text.
      this.nodes.splice(at);
      this.dropDelimitersAfter(bracket.order);
      this.text(this.slice(bracket.start, end + 1));
    } else {
      this.processEmphasis(this.firstDelimiterAfter(bracket.order));
      const children = this.nodes.splice(at + 1);
      this.nodes.splice(at, 1, { kind: 'link', href: destination, children });
      for (const earlier of this.brackets) earlier.active = false;
    }
    this.i = end + 1;
  }

  private firstDelimiterAfter(order: number): number {
    const index = this.delimiters.findIndex((delimiter) => delimiter.order > order);
    return index === -1 ? this.delimiters.length : index;
  }

  private dropDelimitersAfter(order: number): void {
    this.delimiters.splice(this.firstDelimiterAfter(order));
  }

  // CommonMark's "process emphasis" over the delimiters from index bottom upwards.
  private processEmphasis(bottom: number): void {
    const openersBottom = new Map<string, number>();
    let current = bottom;
    while (current < this.delimiters.length) {
      const closer = this.delimiters[current];
      if (closer === undefined || !closer.canClose) {
        current += 1;
        continue;
      }
      const key = `${closer.char}${closer.canOpen ? 1 : 0}${closer.original % 3}`;
      const floor = openersBottom.get(key) ?? -1;
      let found = -1;
      for (let j = current - 1; j >= bottom; j -= 1) {
        const opener = this.delimiters[j];
        if (opener === undefined || opener.order <= floor) break;
        if (opener.char === closer.char && opener.canOpen && !ruleOfThree(opener, closer)) {
          found = j;
          break;
        }
      }
      if (found === -1) {
        openersBottom.set(key, this.delimiters[current - 1]?.order ?? -1);
        if (!closer.canOpen) this.delimiters.splice(current, 1);
        else current += 1;
        continue;
      }
      const opener = this.delimiters[found];
      if (opener === undefined) return;
      const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
      opener.count -= used;
      closer.count -= used;
      const from = this.nodes.indexOf(opener);
      const to = this.nodes.indexOf(closer);
      const children = this.nodes.slice(from + 1, to);
      this.nodes.splice(from + 1, to - from - 1, { kind: used === 2 ? 'strong' : 'em', children });
      this.delimiters.splice(found + 1, current - found - 1);
      current = found + 1;
      if (opener.count === 0) {
        this.nodes.splice(this.nodes.indexOf(opener), 1);
        this.delimiters.splice(found, 1);
        current -= 1;
      }
      if (closer.count === 0) {
        this.nodes.splice(this.nodes.indexOf(closer), 1);
        this.delimiters.splice(current, 1);
      }
    }
    this.delimiters.splice(bottom);
  }
}

// When either side can both open and close, lengths summing to a multiple of 3 cannot pair,
// unless both lengths are multiples of 3.
function ruleOfThree(opener: Delimiter, closer: Delimiter): boolean {
  const ambiguous = (opener.canOpen && opener.canClose) || (closer.canOpen && closer.canClose);
  return (
    ambiguous &&
    (opener.original + closer.original) % 3 === 0 &&
    !(opener.original % 3 === 0 && closer.original % 3 === 0)
  );
}

function serialise(nodes: Inline[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += escapeHtml(node.text);
        break;
      case 'html':
        out += node.html;
        break;
      case 'delimiter':
        out += node.char.repeat(node.count);
        break;
      case 'bracket':
        out += '[';
        break;
      case 'em':
      case 'strong':
        out += `<${node.kind}>${serialise(node.children)}</${node.kind}>`;
        break;
      case 'link':
        out += `<a href="${escapeHtml(node.href)}">${serialise(node.children)}</a>`;
        break;
    }
  }
  return out;
}

export function renderBio(bio: string): string {
  return new Renderer(bio).render();
}
