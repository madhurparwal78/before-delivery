// The page source language: CommonMark (headings, paragraphs, lists, links, emphasis, inline code, fenced code,
// images, plus quotes, rules and tables) and the six components. Raw HTML is never interpreted: it stays text.
// One parse gives the renderer and the gate the same tree, with line numbers and source offsets.

import { anchorOf } from '../../shared/rules';

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'em' | 'strong'; children: Inline[] }
  | { type: 'link'; children: Inline[]; href: string; hrefStart: number; hrefEnd: number; line: number; offset: number }
  | { type: 'image'; alt: string; src: string; line: number; offset: number };

const COMPONENT_NAMES = ['Callout', 'Tabs', 'Tab', 'CodeGroup', 'Steps', 'Step', 'Accordion', 'Cards', 'Card'] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];

export interface Attribute {
  value: string;
  /** Absolute offset of the value in the source (after the opening quote). */
  offset: number;
}

export type Block =
  | { type: 'heading'; level: number; children: Inline[]; text: string; anchor: string | null; line: number }
  | { type: 'paragraph'; children: Inline[]; line: number }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'quote'; children: Block[] }
  | { type: 'code'; lang: string; title: string; value: string; line: number }
  | { type: 'rule' }
  | { type: 'table'; head: Inline[][]; rows: Inline[][][] }
  | {
      type: 'component';
      name: ComponentName;
      attrs: Record<string, Attribute>;
      line: number;
      children: Block[];
      closed: boolean;
    }
  | { type: 'unknown'; name: string; line: number; raw: string };

export interface HeadingInfo {
  level: number;
  text: string;
  anchor: string;
}

export interface Document {
  blocks: Block[];
  /** The h2 and h3 headings in page order: the table of contents and the anchors links may name. */
  headings: HeadingInfo[];
}

type Href =
  | { kind: 'internal'; path: string; anchor: string | null }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'external' }
  | { kind: 'none' };

/** The four kinds of link target. Everything else renders as its link text only. */
export function classifyHref(href: string): Href {
  if (href.startsWith('/')) {
    const hash = href.indexOf('#');
    return hash === -1
      ? { kind: 'internal', path: href, anchor: null }
      : { kind: 'internal', path: href.slice(0, hash), anchor: href.slice(hash + 1) };
  }
  if (href.startsWith('#')) {
    return { kind: 'anchor', anchor: href.slice(1) };
  }
  return /^(https?:|mailto:)/i.test(href) ? { kind: 'external' } : { kind: 'none' };
}

// ---- inline ----------------------------------------------------------------------------------------------

const PUNCTUATION = /[!-/:-@[-`{-~]/;

interface Offsets {
  lineOf: (offset: number) => number;
}

function findCodeEnd(text: string, from: number, run: number): number {
  for (let j = from; j < text.length; j += 1) {
    if (text[j] === '`') {
      let k = j;
      while (text[k] === '`') {
        k += 1;
      }
      if (k - j === run) {
        return j;
      }
      j = k - 1;
    }
  }
  return -1;
}

function findLabelEnd(text: string, open: number): number {
  let depth = 0;
  for (let j = open; j < text.length; j += 1) {
    const c = text[j];
    if (c === '\\') {
      j += 1;
    } else if (c === '`') {
      let k = j;
      while (text[k] === '`') {
        k += 1;
      }
      const end = findCodeEnd(text, k, k - j);
      j = end === -1 ? k - 1 : end + (k - j) - 1;
    } else if (c === '[') {
      depth += 1;
    } else if (c === ']') {
      depth -= 1;
      if (depth === 0) {
        return j;
      }
    }
  }
  return -1;
}

interface Destination {
  href: string;
  start: number;
  end: number;
  next: number;
}

function parseDestination(text: string, from: number): Destination | null {
  let i = from;
  while (text[i] === ' ' || text[i] === '\n') {
    i += 1;
  }
  let start = i;
  let end: number;
  if (text[i] === '<') {
    start = i + 1;
    end = text.indexOf('>', start);
    if (end === -1 || text.slice(start, end).includes('\n')) {
      return null;
    }
    i = end + 1;
  } else {
    let depth = 0;
    while (i < text.length && !/\s/.test(text[i] ?? '')) {
      if (text[i] === '\\') {
        i += 1;
      } else if (text[i] === '(') {
        depth += 1;
      } else if (text[i] === ')') {
        if (depth === 0) {
          break;
        }
        depth -= 1;
      }
      i += 1;
    }
    end = i;
  }
  while (text[i] === ' ' || text[i] === '\n') {
    i += 1;
  }
  const quote = text[i];
  if (quote === '"' || quote === "'" || quote === '(') {
    const close = text.indexOf(quote === '(' ? ')' : quote, i + 1);
    if (close === -1) {
      return null;
    }
    i = close + 1;
    while (text[i] === ' ' || text[i] === '\n') {
      i += 1;
    }
  }
  return text[i] === ')' ? { href: text.slice(start, end), start, end, next: i + 1 } : null;
}

function plain(inlines: Inline[]): string {
  return inlines
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value;
        case 'image':
          return node.alt;
        default:
          return plain(node.children);
      }
    })
    .join('');
}

function findClosing(text: string, from: number, mark: string, count: number): number {
  for (let j = from; j < text.length; j += 1) {
    const c = text[j];
    if (c === '\\') {
      j += 1;
    } else if (c === '`') {
      let k = j;
      while (text[k] === '`') {
        k += 1;
      }
      const end = findCodeEnd(text, k, k - j);
      j = end === -1 ? k - 1 : end + (k - j) - 1;
    } else if (c === mark && text.startsWith(mark.repeat(count), j) && !/\s/.test(text[j - 1] ?? ' ')) {
      const after = text[j + count] ?? ' ';
      if (mark === '*' || !/[A-Za-z0-9]/.test(after)) {
        return j;
      }
    }
  }
  return -1;
}

function parseInline(text: string, base: number, offsets: Offsets): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') {
      out.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (c === '\\' && PUNCTUATION.test(next)) {
      buffer += next;
      i += 2;
    } else if (c === '`') {
      let k = i;
      while (text[k] === '`') {
        k += 1;
      }
      const end = findCodeEnd(text, k, k - i);
      if (end === -1) {
        buffer += text.slice(i, k);
        i = k;
      } else {
        flush();
        let value = text.slice(k, end).replace(/\n/g, ' ');
        if (value.length > 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') {
          value = value.slice(1, -1);
        }
        out.push({ type: 'code', value });
        i = end + (k - i);
      }
    } else if (c === '[' || (c === '!' && next === '[')) {
      const open = c === '!' ? i + 1 : i;
      const close = findLabelEnd(text, open);
      const destination = close === -1 || text[close + 1] !== '(' ? null : parseDestination(text, close + 2);
      if (close === -1 || destination === null) {
        buffer += c;
        i += 1;
      } else {
        flush();
        const label = text.slice(open + 1, close);
        const children = parseInline(label, base + open + 1, offsets);
        const line = offsets.lineOf(base + i);
        if (c === '!') {
          out.push({ type: 'image', alt: plain(children), src: destination.href, line, offset: base + i });
        } else {
          out.push({
            type: 'link',
            children,
            href: destination.href,
            hrefStart: base + destination.start,
            hrefEnd: base + destination.end,
            line,
            offset: base + i,
          });
        }
        i = destination.next;
      }
    } else if ((c === '*' || c === '_') && !/\s/.test(next) && next !== '' && (c === '*' || !/[A-Za-z0-9]/.test(text[i - 1] ?? ' '))) {
      let run = 0;
      while (text[i + run] === c) {
        run += 1;
      }
      const count = run >= 2 ? 2 : 1;
      const end = findClosing(text, i + count, c, count);
      if (end === -1 || end === i + count) {
        buffer += c.repeat(run);
        i += run;
      } else {
        flush();
        out.push({
          type: count === 2 ? 'strong' : 'em',
          children: parseInline(text.slice(i + count, end), base + i + count, offsets),
        });
        i = end + count;
      }
    } else {
      buffer += c;
      i += 1;
    }
  }
  flush();
  return out;
}

// ---- blocks ----------------------------------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])( *\1){2,} *$/;
const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/;
const QUOTE = /^ {0,3}>/;
const TAG_START = /^<(\/)?([A-Z][A-Za-z0-9]*)/;
const TAG_LINE = /^<(\/)?([A-Z][A-Za-z0-9]*)((?:\s+[A-Za-z-]+="[^"]*")*)\s*>$/;
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isKnown = (name: string): name is ComponentName => (COMPONENT_NAMES as readonly string[]).includes(name);

interface KnownTag {
  kind: 'open' | 'close';
  name: ComponentName;
  attrs: string;
  attrsAt: number;
}
type Tag = KnownTag | { kind: 'unknown'; name: string };

/** A line that begins `<` and a capital letter is a component tag, or an unknown component. */
function tagOf(line: string): Tag | null {
  const trimmed = line.trim();
  const start = TAG_START.exec(trimmed);
  if (start === null) {
    return null;
  }
  const name = start[2] ?? '';
  const whole = TAG_LINE.exec(trimmed);
  if (whole !== null && isKnown(name)) {
    const attrs = whole[3] ?? '';
    return { kind: whole[1] ? 'close' : 'open', name, attrs, attrsAt: line.length - line.trimStart().length + start[0].length };
  }
  return start[1] ? null : { kind: 'unknown', name };
}

function startsBlock(line: string, nextLine: string | undefined): boolean {
  if (FENCE.test(line) || ATX.test(line) || RULE.test(line) || QUOTE.test(line) || tagOf(line) !== null) {
    return true;
  }
  const list = LIST.exec(line);
  if (list !== null) {
    const marker = list[2] ?? '';
    return line.slice(list[0].length).trim() !== '' && (/^[-*+]$/.test(marker) || marker.startsWith('1'));
  }
  return line.includes('|') && nextLine !== undefined && DELIMITER.test(nextLine) && nextLine.includes('-');
}

function splitRow(line: string, lineStart: number): { text: string; offset: number }[] {
  const cells: { text: string; offset: number }[] = [];
  let begin = 0;
  const body = line.trimEnd();
  const lead = body.match(/^\s*\|?/)?.[0].length ?? 0;
  begin = lead;
  for (let i = lead; i <= body.length; i += 1) {
    if (i === body.length || (body[i] === '|' && body[i - 1] !== '\\')) {
      if (!(i === body.length && body.slice(begin).trim() === '')) {
        const raw = body.slice(begin, i);
        const padding = raw.length - raw.trimStart().length;
        cells.push({ text: raw.trim(), offset: lineStart + begin + padding });
      }
      begin = i + 1;
    }
  }
  return cells;
}

class BlockParser {
  constructor(
    private readonly lines: string[],
    private readonly starts: number[],
    private readonly offsets: Offsets,
  ) {}

  private inline(text: string, base: number): Inline[] {
    return parseInline(text, base, this.offsets);
  }

  /** Parse lines [from, to). `stack` holds the open components; a closing tag ends the innermost one. */
  parse(from: number, to: number, stack: string[]): { blocks: Block[]; next: number; closed: boolean } {
    const blocks: Block[] = [];
    let i = from;
    while (i < to) {
      const line = this.lines[i] ?? '';
      if (line.trim() === '') {
        i += 1;
        continue;
      }
      const fence = FENCE.exec(line);
      if (fence !== null) {
        i = this.fenced(fence, i, to, blocks);
        continue;
      }
      const tag = tagOf(line);
      if (tag !== null) {
        if (tag.kind === 'unknown') {
          blocks.push({ type: 'unknown', name: tag.name, line: i + 1, raw: line.trim() });
          i += 1;
        } else if (tag.kind === 'close') {
          if (stack[stack.length - 1] === tag.name) {
            return { blocks, next: i + 1, closed: true };
          }
          if (stack.includes(tag.name)) {
            return { blocks, next: i, closed: false };
          }
          i += 1;
        } else {
          i = this.component(tag, i, to, stack, blocks);
        }
        continue;
      }
      const atx = ATX.exec(line);
      if (atx !== null) {
        const hashes = (atx[1] ?? '#').length;
        const text = atx[2] ?? '';
        const textAt = text === '' ? 0 : line.indexOf(text, line.indexOf('#') + hashes);
        const children = this.inline(text, (this.starts[i] ?? 0) + textAt);
        blocks.push({ type: 'heading', level: Math.max(2, hashes), children, text: plain(children), anchor: null, line: i + 1 });
        i += 1;
      } else if (RULE.test(line)) {
        blocks.push({ type: 'rule' });
        i += 1;
      } else if (QUOTE.test(line)) {
        i = this.quote(i, to, stack, blocks);
      } else if (LIST.test(line)) {
        i = this.list(i, to, stack, blocks);
      } else if (line.includes('|') && DELIMITER.test(this.lines[i + 1] ?? '') && (this.lines[i + 1] ?? '').includes('-')) {
        i = this.table(i, to, blocks);
      } else {
        i = this.paragraph(i, to, blocks);
      }
    }
    return { blocks, next: i, closed: false };
  }

  private fenced(fence: RegExpExecArray, at: number, to: number, blocks: Block[]): number {
    const marker = fence[1] ?? '```';
    const info = (fence[2] ?? '').trim();
    const space = info.search(/\s/);
    const lang = space === -1 ? info : info.slice(0, space);
    const title = space === -1 ? '' : info.slice(space).trim();
    const body: string[] = [];
    let i = at + 1;
    while (i < to) {
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(this.lines[i] ?? '');
      if (closing !== null && (closing[1] ?? '').startsWith(marker[0] ?? '`') && (closing[1] ?? '').length >= marker.length) {
        i += 1;
        break;
      }
      body.push(this.lines[i] ?? '');
      i += 1;
    }
    blocks.push({ type: 'code', lang, title, value: body.join('\n'), line: at + 1 });
    return i;
  }

  private component(tag: KnownTag, at: number, to: number, stack: string[], blocks: Block[]): number {
    const attrs: Record<string, Attribute> = {};
    const lineStart = this.starts[at] ?? 0;
    for (const m of tag.attrs.matchAll(/([A-Za-z-]+)="([^"]*)"/g)) {
      attrs[m[1] ?? ''] = { value: m[2] ?? '', offset: lineStart + tag.attrsAt + (m.index ?? 0) + (m[1] ?? '').length + 2 };
    }
    const inner = this.parse(at + 1, to, [...stack, tag.name]);
    blocks.push({ type: 'component', name: tag.name, attrs, line: at + 1, children: inner.blocks, closed: inner.closed });
    return inner.next;
  }

  private quote(at: number, to: number, stack: string[], blocks: Block[]): number {
    const masked = [...this.lines];
    let i = at;
    while (i < to && QUOTE.test(masked[i] ?? '')) {
      masked[i] = (masked[i] ?? '').replace(/^( {0,3})> ?/, (m) => ' '.repeat(m.length));
      i += 1;
    }
    blocks.push({ type: 'quote', children: new BlockParser(masked, this.starts, this.offsets).parse(at, i, stack).blocks });
    return i;
  }

  private list(at: number, to: number, stack: string[], blocks: Block[]): number {
    const first = LIST.exec(this.lines[at] ?? '') as RegExpExecArray;
    const ordered = /\d/.test(first[2] ?? '');
    const bullet = ordered ? '' : (first[2] ?? '');
    const items: Block[][] = [];
    let i = at;
    while (i < to) {
      const head = LIST.exec(this.lines[i] ?? '');
      if (head === null || /\d/.test(head[2] ?? '') !== ordered || (!ordered && head[2] !== bullet)) {
        break;
      }
      const width = head[0].length;
      const indent = Math.min(width, (head[1] ?? '').length + (head[2] ?? '').length + 1);
      const masked = [...this.lines];
      masked[i] = ' '.repeat(Math.max(width, indent)) + (this.lines[i] ?? '').slice(width);
      let end = i + 1;
      while (end < to) {
        const row = this.lines[end] ?? '';
        const lead = row.length - row.trimStart().length;
        if (row.trim() === '') {
          const following = this.lines.slice(end + 1, to).find((l) => l.trim() !== '');
          if (following === undefined || following.length - following.trimStart().length < indent) {
            break;
          }
        } else if (lead < indent) {
          const previousBlank = (this.lines[end - 1] ?? '').trim() === '';
          if (previousBlank || startsBlock(row, this.lines[end + 1]) || LIST.test(row)) {
            break;
          }
        } else {
          masked[end] = ' '.repeat(Math.min(lead, indent)) + row.slice(Math.min(lead, indent));
        }
        end += 1;
      }
      items.push(new BlockParser(masked, this.starts, this.offsets).parse(i, end, stack).blocks);
      i = end;
      while (i < to && (this.lines[i] ?? '').trim() === '' && LIST.test(this.lines[i + 1] ?? '')) {
        i += 1;
      }
    }
    blocks.push({ type: 'list', ordered, start: ordered ? Number.parseInt(first[2] ?? '1', 10) : 1, items });
    return i;
  }

  private table(at: number, to: number, blocks: Block[]): number {
    const cellsOf = (row: number): Inline[][] =>
      splitRow(this.lines[row] ?? '', this.starts[row] ?? 0).map((cell) => this.inline(cell.text, cell.offset));
    const head = cellsOf(at);
    const rows: Inline[][][] = [];
    let i = at + 2;
    while (i < to && (this.lines[i] ?? '').trim() !== '' && (this.lines[i] ?? '').includes('|') && tagOf(this.lines[i] ?? '') === null) {
      rows.push(cellsOf(i));
      i += 1;
    }
    blocks.push({ type: 'table', head, rows });
    return i;
  }

  private paragraph(at: number, to: number, blocks: Block[]): number {
    let i = at + 1;
    while (i < to && (this.lines[i] ?? '').trim() !== '' && !startsBlock(this.lines[i] ?? '', this.lines[i + 1])) {
      i += 1;
    }
    const text = this.lines.slice(at, i).join('\n');
    blocks.push({ type: 'paragraph', children: this.inline(text, this.starts[at] ?? 0), line: at + 1 });
    return i;
  }
}

/** Walk the blocks in page order, including those inside lists, quotes and components. */
export function walkBlocks(blocks: Block[], visit: (block: Block, parent: Block | null) => void, parent: Block | null = null): void {
  for (const block of blocks) {
    visit(block, parent);
    if (block.type === 'quote' || block.type === 'component') {
      walkBlocks(block.children, visit, block);
    } else if (block.type === 'list') {
      for (const item of block.items) {
        walkBlocks(item, visit, block);
      }
    }
  }
}

/** The inline nodes a block holds directly. */
function inlinesOf(block: Block): Inline[] {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return block.children;
    case 'table':
      return [...block.head.flat(), ...block.rows.flat(2)];
    default:
      return [];
  }
}

function walkInlines(nodes: Inline[], visit: (node: Inline) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === 'link' || node.type === 'em' || node.type === 'strong') {
      walkInlines(node.children, visit);
    }
  }
}

export function parseMarkdown(source: string): Document {
  const lines = normalizeSource(source).split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const offsets: Offsets = {
    lineOf: (offset) => {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((starts[middle] ?? 0) <= offset) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      return low + 1;
    },
  };
  const blocks = new BlockParser(lines, starts, offsets).parse(0, lines.length, []).blocks;
  const headings: HeadingInfo[] = [];
  const used = new Map<string, number>();
  walkBlocks(blocks, (block) => {
    if (block.type === 'heading' && block.level <= 3) {
      const base = anchorOf(block.text);
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      block.anchor = count === 1 ? base : `${base}-${count}`;
      headings.push({ level: block.level, text: block.text, anchor: block.anchor });
    }
  });
  return { blocks, headings };
}

/** Plain text of a document, for search. */
export function documentText(blocks: Block[]): string {
  const parts: string[] = [];
  walkBlocks(blocks, (block) => {
    if (block.type === 'code') {
      parts.push(block.value);
    } else if (block.type === 'component') {
      parts.push(...Object.values(block.attrs).map((attribute) => attribute.value).filter((v) => !v.startsWith('/')));
    } else if (block.type === 'table') {
      parts.push(...[block.head, ...block.rows].flat().map(plain));
    } else if (block.type === 'heading' || block.type === 'paragraph') {
      parts.push(plain(block.children));
    }
  });
  return parts.join('\n');
}

/** Line endings as the parser sees them; offsets from `parseMarkdown` index this form. */
export const normalizeSource = (source: string): string => source.replace(/\r\n?/g, '\n');

/** The id of an uploaded image named by `/assets/<siteSlug>/<imageId>`, or null for any other source. */
export function assetIdOf(siteSlug: string, src: string): string | null {
  return new RegExp(`^/assets/${siteSlug}/([A-Za-z0-9_-]+)$`).exec(src)?.[1] ?? null;
}

interface LinkTarget {
  kind: 'internal' | 'anchor';
  /** For `internal`, the path with its leading slash. */
  path: string;
  anchor: string | null;
  line: number;
  /** Offset of the link in the source, to order problems within a line. */
  offset: number;
  /** Where the path (or, for an anchor link, the whole destination) sits in the normalised source. */
  start: number;
  end: number;
}

/** Every internal link and same-page anchor link of a document, markdown links and Card hrefs alike. */
export function linkTargets(document: Document): LinkTarget[] {
  const found: LinkTarget[] = [];
  const add = (href: string, line: number, offset: number, start: number): void => {
    const target = classifyHref(href);
    if (target.kind === 'internal') {
      found.push({ kind: 'internal', path: target.path, anchor: target.anchor, line, offset, start, end: start + target.path.length });
    } else if (target.kind === 'anchor') {
      found.push({ kind: 'anchor', path: '', anchor: target.anchor, line, offset, start, end: start + href.length });
    }
  };
  walkBlocks(document.blocks, (block) => {
    if (block.type === 'component' && block.name === 'Card' && block.attrs.href) {
      add(block.attrs.href.value, block.line, block.attrs.href.offset, block.attrs.href.offset);
    }
    walkInlines(inlinesOf(block), (node) => {
      if (node.type === 'link') {
        add(node.href, node.line, node.offset, node.hrefStart);
      }
    });
  });
  return found;
}

/** Every image of a document. */
export function imageNodes(document: Document): Extract<Inline, { type: 'image' }>[] {
  const found: Extract<Inline, { type: 'image' }>[] = [];
  walkBlocks(document.blocks, (block) => {
    walkInlines(inlinesOf(block), (node) => {
      if (node.type === 'image') {
        found.push(node);
      }
    });
  });
  return found;
}
