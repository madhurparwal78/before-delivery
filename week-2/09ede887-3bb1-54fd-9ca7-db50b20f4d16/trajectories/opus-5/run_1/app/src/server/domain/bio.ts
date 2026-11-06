/**
 * The published CommonMark subset used for speaker bios: emphasis, strong
 * emphasis, code spans, inline links, autolinks, backslash escapes and hard
 * line breaks. Everything else is literal text. The output is inline HTML
 * with no paragraph wrapper.
 */

const ASCII_PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
const UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;

export function escapeHtmlText(text: string): string {
  let out = '';
  for (const character of text) {
    if (character === '&') out += '&amp;';
    else if (character === '<') out += '&lt;';
    else if (character === '>') out += '&gt;';
    else if (character === '"') out += '&quot;';
    else out += character;
  }
  return out;
}

interface Preprocessed {
  readonly source: string;
  /** Indices of line feeds in `source` that stand for a hard break. */
  readonly hardBreaks: ReadonlySet<number>;
}

function preprocess(bio: string): Preprocessed {
  const normalised = bio.replace(/\r\n|\r/g, '\n').trim();
  const lines = normalised.split('\n');
  const hardBreaks = new Set<number>();
  let source = '';
  for (const [index, line] of lines.entries()) {
    source += line.replace(/^ +/, '').replace(/ +$/, '');
    if (index < lines.length - 1) {
      if (/ {2,}$/.test(line)) hardBreaks.add(source.length);
      source += '\n';
    }
  }
  return { source, hardBreaks };
}

interface TextItem {
  readonly kind: 'text';
  value: string;
}
interface HtmlItem {
  readonly kind: 'html';
  readonly value: string;
}
interface DelimItem {
  readonly kind: 'delim';
  readonly char: string;
  readonly original: number;
  count: number;
  canOpen: boolean;
  canClose: boolean;
  readonly openTags: string[];
  readonly closeTags: string[];
}
type Item = TextItem | HtmlItem | DelimItem;

interface Delimiter {
  readonly itemIndex: number;
  removed: boolean;
}

interface Bracket {
  readonly itemIndex: number;
  readonly sourceStart: number;
  readonly delimBottom: number;
  active: boolean;
}

function isWhitespaceChar(character: string | undefined): boolean {
  return character === undefined || /\s/.test(character);
}

function isPunctuationChar(character: string | undefined): boolean {
  if (character === undefined) return false;
  return ASCII_PUNCTUATION.has(character) || UNICODE_PUNCTUATION.test(character);
}

class InlineParser {
  private readonly items: Item[] = [];
  private readonly delims: Delimiter[] = [];
  private readonly brackets: Bracket[] = [];
  private position = 0;

  constructor(
    private readonly source: string,
    private readonly hardBreaks: ReadonlySet<number>,
  ) {}

  render(): string {
    while (this.position < this.source.length) {
      const character = this.source[this.position] as string;
      switch (character) {
        case '`':
          this.readCodeSpan();
          break;
        case '<':
          this.readAutolink();
          break;
        case '\\':
          this.readBackslash();
          break;
        case '[':
          this.readOpenBracket();
          break;
        case ']':
          this.readCloseBracket();
          break;
        case '*':
        case '_':
          this.readDelimiterRun(character);
          break;
        case '\n':
          this.pushHtml(this.hardBreaks.has(this.position) ? '<br>\n' : '\n');
          this.position += 1;
          break;
        default:
          this.pushText(character);
          this.position += 1;
      }
    }
    this.processEmphasis(-1);
    return this.items.map(renderItem).join('');
  }

  private pushText(value: string): void {
    const last = this.items[this.items.length - 1];
    if (last !== undefined && last.kind === 'text') last.value += value;
    else this.items.push({ kind: 'text', value });
  }

  private pushHtml(value: string): void {
    this.items.push({ kind: 'html', value });
  }

  private readCodeSpan(): void {
    let openLength = 0;
    while (this.source[this.position + openLength] === '`') openLength += 1;
    const contentStart = this.position + openLength;
    let scan = contentStart;
    while (scan < this.source.length) {
      if (this.source[scan] !== '`') {
        scan += 1;
        continue;
      }
      let runLength = 0;
      while (this.source[scan + runLength] === '`') runLength += 1;
      if (runLength === openLength) {
        const raw = this.source.slice(contentStart, scan).replace(/\n/g, ' ');
        const content = raw.startsWith(' ') && raw.endsWith(' ') && raw.trim() !== '' ? raw.slice(1, -1) : raw;
        this.pushHtml(`<code>${escapeHtmlText(content)}</code>`);
        this.position = scan + runLength;
        return;
      }
      scan += runLength;
    }
    this.pushText('`'.repeat(openLength));
    this.position = contentStart;
  }

  private readAutolink(): void {
    const end = this.matchAutolinkEnd();
    if (end === null) {
      this.pushText('<');
      this.position += 1;
      return;
    }
    const whole = this.source.slice(this.position, end);
    const url = whole.slice(1, -1);
    if (/^https?:/i.test(url)) {
      const escaped = escapeHtmlText(url);
      this.pushHtml(`<a href="${escaped}">${escaped}</a>`);
    } else {
      this.pushText(whole);
    }
    this.position = end;
  }

  /** The index just past the closing `>` of an autolink, or null. */
  private matchAutolinkEnd(): number | null {
    let scan = this.position + 1;
    const first = this.source[scan];
    if (first === undefined || !/[A-Za-z]/.test(first)) return null;
    scan += 1;
    while (scan < this.source.length) {
      const character = this.source[scan] as string;
      if (character === ':') break;
      if (!/[A-Za-z0-9+.-]/.test(character)) return null;
      scan += 1;
    }
    if (this.source[scan] !== ':') return null;
    scan += 1;
    while (scan < this.source.length) {
      const character = this.source[scan] as string;
      if (character === '>') return scan + 1;
      if (character === '<' || /\s/.test(character)) return null;
      scan += 1;
    }
    return null;
  }

  private readBackslash(): void {
    const next = this.source[this.position + 1];
    if (next === '\n') {
      this.pushHtml('<br>\n');
      this.position += 2;
      return;
    }
    if (next !== undefined && ASCII_PUNCTUATION.has(next)) {
      this.pushText(next);
      this.position += 2;
      return;
    }
    this.pushText('\\');
    this.position += 1;
  }

  private readOpenBracket(): void {
    this.brackets.push({
      itemIndex: this.items.length,
      sourceStart: this.position,
      delimBottom: this.delims.length - 1,
      active: true,
    });
    // A standalone item, so that a later link replaces exactly this bracket.
    this.items.push({ kind: 'html', value: '[' });
    this.position += 1;
  }

  private readCloseBracket(): void {
    const bracket = this.brackets.pop();
    if (bracket === undefined) {
      this.pushText(']');
      this.position += 1;
      return;
    }
    const link = this.matchInlineLink(this.position + 1);
    if (link === null || !bracket.active) {
      this.pushText(']');
      this.position += 1;
      return;
    }
    if (isSafeLinkDestination(link.destination)) {
      this.processEmphasis(bracket.delimBottom);
      this.items[bracket.itemIndex] = { kind: 'html', value: `<a href="${escapeHtmlText(link.destination)}">` };
      this.pushHtml('</a>');
      for (const other of this.brackets) other.active = false;
    } else {
      this.truncateTo(bracket.itemIndex);
      this.pushText(this.source.slice(bracket.sourceStart, link.end));
    }
    this.position = link.end;
  }

  /** Drops every item and delimiter from `length` onwards. */
  private truncateTo(length: number): void {
    this.items.length = length;
    for (const delimiter of this.delims) {
      if (delimiter.itemIndex >= length) delimiter.removed = true;
    }
  }

  private matchInlineLink(start: number): { readonly destination: string; readonly end: number } | null {
    if (this.source[start] !== '(') return null;
    let scan = start + 1;
    let depth = 0;
    let destination = '';
    while (scan < this.source.length) {
      const character = this.source[scan] as string;
      if (/\s/.test(character) || character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) return null;
      if (character === '(') depth += 1;
      else if (character === ')') {
        if (depth === 0) return { destination, end: scan + 1 };
        depth -= 1;
      }
      destination += character;
      scan += 1;
    }
    return null;
  }

  private readDelimiterRun(char: string): void {
    let count = 0;
    while (this.source[this.position + count] === char) count += 1;
    const before = this.position === 0 ? undefined : this.source[this.position - 1];
    const after = this.source[this.position + count];
    const afterWhitespace = isWhitespaceChar(after);
    const beforeWhitespace = isWhitespaceChar(before);
    const afterPunctuation = isPunctuationChar(after);
    const beforePunctuation = isPunctuationChar(before);
    const leftFlanking =
      !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
    const rightFlanking =
      !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);
    const canOpen = char === '*' ? leftFlanking : leftFlanking && (!rightFlanking || beforePunctuation);
    const canClose = char === '*' ? rightFlanking : rightFlanking && (!leftFlanking || afterPunctuation);
    this.delims.push({ itemIndex: this.items.length, removed: false });
    this.items.push({ kind: 'delim', char, original: count, count, canOpen, canClose, openTags: [], closeTags: [] });
    this.position += count;
  }

  private delimAt(index: number): DelimItem | null {
    const reference = this.delims[index];
    if (reference === undefined || reference.removed) return null;
    const item = this.items[reference.itemIndex];
    return item !== undefined && item.kind === 'delim' ? item : null;
  }

  private processEmphasis(bottom: number): void {
    let closerIndex = bottom + 1;
    while (closerIndex < this.delims.length) {
      const closer = this.delimAt(closerIndex);
      if (closer === null || !closer.canClose) {
        closerIndex += 1;
        continue;
      }
      let openerIndex = -1;
      for (let scan = closerIndex - 1; scan > bottom; scan -= 1) {
        const opener = this.delimAt(scan);
        if (opener === null || !opener.canOpen || opener.char !== closer.char) continue;
        const bothWays = closer.canOpen || opener.canClose;
        const sumIsMultiple = (closer.original + opener.original) % 3 === 0;
        const bothMultiples = closer.original % 3 === 0 && opener.original % 3 === 0;
        if (bothWays && sumIsMultiple && !bothMultiples) continue;
        openerIndex = scan;
        break;
      }
      if (openerIndex === -1) {
        if (!closer.canOpen) (this.delims[closerIndex] as Delimiter).removed = true;
        closerIndex += 1;
        continue;
      }
      const opener = this.delimAt(openerIndex) as DelimItem;
      const used = closer.count >= 2 && opener.count >= 2 ? 2 : 1;
      const tag = used === 2 ? 'strong' : 'em';
      opener.openTags.push(`<${tag}>`);
      closer.closeTags.push(`</${tag}>`);
      opener.count -= used;
      closer.count -= used;
      for (let between = openerIndex + 1; between < closerIndex; between += 1) {
        (this.delims[between] as Delimiter).removed = true;
      }
      if (opener.count === 0) (this.delims[openerIndex] as Delimiter).removed = true;
      if (closer.count === 0) {
        (this.delims[closerIndex] as Delimiter).removed = true;
        closerIndex += 1;
      }
    }
    for (let index = bottom + 1; index < this.delims.length; index += 1) {
      (this.delims[index] as Delimiter).removed = true;
    }
    this.delims.length = bottom + 1;
  }
}

function isSafeLinkDestination(destination: string): boolean {
  const lower = destination.toLowerCase();
  if (lower.startsWith('http://')) return destination.length > 'http://'.length;
  if (lower.startsWith('https://')) return destination.length > 'https://'.length;
  return false;
}

function renderItem(item: Item): string {
  if (item.kind === 'text') return escapeHtmlText(item.value);
  if (item.kind === 'html') return item.value;
  return (
    item.closeTags.join('') +
    item.char.repeat(item.count) +
    [...item.openTags].reverse().join('')
  );
}

export function renderBio(bio: string): string {
  const { source, hardBreaks } = preprocess(bio);
  return new InlineParser(source, hardBreaks).render();
}
