export type SourcePos = { line: number; col: number };

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'link'; text: string; target: string; pos: SourcePos; targetCol: number; targetEndCol: number }
  | { kind: 'image'; alt: string; url: string; pos: SourcePos };

export type TabItem = { title: string; line: number; children: Block[] };
export type StepItem = { title: string; line: number; children: Block[] };
export type CardItem = { title: string; href: string; line: number; children: Block[] };
export type CodeItem = { lang: string | null; title: string | null; text: string; line: number };

export type Block =
  | { kind: 'heading'; level: number; text: string; line: number; anchor: string | null }
  | { kind: 'paragraph'; inlines: Inline[]; line: number }
  | { kind: 'list'; ordered: boolean; items: Inline[][]; line: number }
  | { kind: 'code'; lang: string | null; title: string | null; text: string; line: number }
  | { kind: 'callout'; type: string; line: number; children: Block[] }
  | { kind: 'tabs'; line: number; tabs: TabItem[]; trailing: Block[] }
  | { kind: 'code-group'; line: number; blocks: CodeItem[]; trailing: Block[] }
  | { kind: 'steps'; line: number; steps: StepItem[]; trailing: Block[] }
  | { kind: 'accordion'; line: number; title: string; children: Block[] }
  | { kind: 'cards'; line: number; cards: CardItem[]; trailing: Block[] }
  | { kind: 'try-it'; line: number; operationId: string };

export type ParsedIssue =
  | { code: 'unknown_component'; line: number; col: number; name: string }
  | { code: 'invalid_component'; line: number; col: number; message: string };

export type LinkUse = {
  path: string | null; anchor: string | null; target: string;
  line: number; col: number; targetCol: number; targetEndCol: number;
};
export type ImageUse = { url: string; line: number; col: number };
export type CardUse = { href: string; path: string | null; anchor: string | null; line: number; col: number };

export type ParsedPage = {
  blocks: Block[];
  issues: ParsedIssue[];
  links: LinkUse[];
  images: ImageUse[];
  cards: CardUse[];
};

const TAG_RE = /^<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z-]+="[^"]*")*)\s*(\/?)>$/;
const ATTR_RE = /([A-Za-z-]+)="([^"]*)"/g;
const FENCE_RE = /^```(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+[.)]\s+(.*)$/;

const CONTAINER_TAGS = new Set(['Callout', 'Tabs', 'CodeGroup', 'Steps', 'Accordion', 'Cards', 'TryIt']);
const ITEM_TAGS = new Set(['Tab', 'Step', 'Card']);

type Attrs = Map<string, string>;

function parseAttrs(raw: string): Attrs {
  const map = new Map<string, string>();
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw)) !== null) map.set(m[1], m[2]);
  return map;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

class Parser {
  private readonly lines: string[];
  private i = 0;
  readonly issues: ParsedIssue[] = [];
  readonly links: LinkUse[] = [];
  readonly images: ImageUse[] = [];
  readonly cards: CardUse[] = [];

  constructor(source: string) {
    this.lines = source.split('\n');
  }

  run(): Block[] {
    return this.parseBlocks([]);
  }

  private line(): string { return this.lines[this.i] ?? ''; }
  private total(): number { return this.lines.length; }

  private parseBlocks(stopTags: string[]): Block[] {
    const blocks: Block[] = [];
    while (this.i < this.total()) {
      const raw = this.line();
      const trimmed = raw.trim();
      if (trimmed === '') { this.i++; continue; }
      const closeMatch = trimmed.match(/^<\/([A-Za-z][A-Za-z0-9]*)>$/);
      if (closeMatch && stopTags.includes(closeMatch[1])) return blocks;

      const tagMatch = trimmed.match(TAG_RE);
      if (tagMatch) {
        const closing = tagMatch[1] === '/';
        const selfClosing = tagMatch[4] === '/';
        const name = tagMatch[2];
        const attrs = parseAttrs(tagMatch[3]);
        const col = raw.indexOf('<');
        if (!closing && selfClosing && name === 'TryIt') {
          blocks.push({ kind: 'try-it', line: this.i + 1, operationId: attrs.get('operationId') ?? '' });
          this.i++;
          continue;
        }
        if (!closing && CONTAINER_TAGS.has(name)) {
          blocks.push(this.parseContainer(name, attrs, col));
          continue;
        }
        if (!closing && ITEM_TAGS.has(name)) {
          blocks.push(...this.parseOrphanItem(name, attrs, col));
          continue;
        }
        if (!closing && /^[A-Z]/.test(name)) {
          this.issues.push({ code: 'unknown_component', line: this.i + 1, col, name });
          this.i++;
          continue;
        }
        if (closing) { this.i++; continue; }
      }
      if (trimmed.startsWith('<') && /^[A-Z]/.test(trimmed.slice(1, 2)) && !tagMatch) {
        const nameMatch = trimmed.match(/^<([A-Za-z][A-Za-z0-9]*)/);
        this.issues.push({ code: 'unknown_component', line: this.i + 1, col: raw.indexOf('<'), name: nameMatch ? nameMatch[1] : trimmed.slice(1) });
        this.i++;
        continue;
      }
      const fence = trimmed.match(FENCE_RE);
      if (fence && !stopTags.includes('')) {
        blocks.push(this.parseCodeFence(fence[1]));
        continue;
      }
      const heading = trimmed.match(HEADING_RE);
      if (heading) {
        blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim(), line: this.i + 1, anchor: null });
        this.i++;
        continue;
      }
      const ul = trimmed.match(UL_RE);
      const ol = trimmed.match(OL_RE);
      if (ul || ol) {
        blocks.push(this.parseList(!!ol));
        continue;
      }
      blocks.push(this.parseParagraph());
    }
    return blocks;
  }

  private parseCodeFence(info: string): Block {
    const startLine = this.i + 1;
    const infoTrimmed = info.trim();
    const parts = infoTrimmed.split(/\s+/);
    const lang = parts[0] && parts[0].length > 0 ? parts[0] : null;
    const title = parts.length > 1 ? parts.slice(1).join(' ') : null;
    this.i++;
    const body: string[] = [];
    while (this.i < this.total()) {
      const l = this.line().trim();
      if (l.match(/^```$/)) { this.i++; break; }
      body.push(this.lines[this.i]);
      this.i++;
    }
    return { kind: 'code', lang, title, text: body.join('\n'), line: startLine };
  }

  private parseList(ordered: boolean): Block {
    const startLine = this.i + 1;
    const items: Inline[][] = [];
    while (this.i < this.total()) {
      const trimmed = this.line().trim();
      if (isBlank(trimmed)) break;
      const ul = trimmed.match(UL_RE);
      const ol = trimmed.match(OL_RE);
      if (ordered && !ol) break;
      if (!ordered && !ul) break;
      const content = (ordered ? ol![1] : ul![1]) ?? '';
      items.push(parseInlines(content, this.i + 1, this));
      this.i++;
    }
    return { kind: 'list', ordered, items, line: startLine };
  }

  private parseParagraph(): Block {
    const startLine = this.i + 1;
    const lines: string[] = [];
    while (this.i < this.total()) {
      const trimmed = this.line().trim();
      if (isBlank(trimmed)) break;
      if (trimmed.match(FENCE_RE)) break;
      if (trimmed.match(HEADING_RE)) break;
      if (trimmed.match(/^<\/[A-Za-z][A-Za-z0-9]*>$/)) break;
      const t = trimmed.match(TAG_RE);
      if (t && !t[1] && (CONTAINER_TAGS.has(t[2]) || ITEM_TAGS.has(t[2]))) break;
      if (t && !t[1] && /^[A-Z]/.test(t[2])) break;
      if (trimmed.startsWith('<') && /^[A-Z]/.test(trimmed.slice(1, 2))) break;
      lines.push(trimmed);
      this.i++;
    }
    if (lines.length === 0) { this.i++; return { kind: 'paragraph', inlines: [], line: startLine }; }
    const inlines = parseInlines(lines.join(' '), startLine, this);
    return { kind: 'paragraph', inlines, line: startLine };
  }

  private parseContainer(name: string, attrs: Attrs, col: number): Block {
    const line = this.i + 1;
    this.i++;
    switch (name) {
      case 'Callout': {
        const children = this.parseBlocks(['Callout']);
        const type = attrs.get('type') ?? '';
        if (!['note', 'tip', 'warning', 'danger'].includes(type)) {
          this.issues.push({ code: 'invalid_component', line, col, message: 'Callout needs type note, tip, warning or danger.' });
        }
        return { kind: 'callout', type: ['note', 'tip', 'warning', 'danger'].includes(type) ? type : 'note', line, children };
      }
      case 'Accordion': {
        const children = this.parseBlocks(['Accordion']);
        const title = attrs.get('title');
        if (!title) this.issues.push({ code: 'invalid_component', line, col, message: 'Accordion needs a title.' });
        return { kind: 'accordion', line, title: title ?? '', children };
      }
      case 'Tabs': {
        const { items, trailing } = this.parseItems<TabItem>('Tabs', 'Tab', (a, ln, children) => ({ title: a.get('title') ?? '', line: ln, children }), 'Tab needs a title.');
        if (items.length < 2) this.issues.push({ code: 'invalid_component', line, col, message: 'Tabs needs 2 or more Tab items.' });
        const seen = new Set<string>();
        for (const t of items) {
          if (t.title && seen.has(t.title)) {
            this.issues.push({ code: 'invalid_component', line: t.line, col: 0, message: `Tab title "${t.title}" is used twice in these Tabs.` });
          }
          if (t.title) seen.add(t.title);
        }
        return { kind: 'tabs', line, tabs: items, trailing };
      }
      case 'Steps': {
        const { items, trailing } = this.parseItems<StepItem>('Steps', 'Step', (a, ln, children) => ({ title: a.get('title') ?? '', line: ln, children }), 'Step needs a title.');
        if (items.length < 1) this.issues.push({ code: 'invalid_component', line, col, message: 'Steps needs 1 or more Step items.' });
        return { kind: 'steps', line, steps: items, trailing };
      }
      case 'Cards': {
        const { items, trailing } = this.parseItems<CardItem>('Cards', 'Card', (a, ln, children) => ({ title: a.get('title') ?? '', href: a.get('href') ?? '', line: ln, children }), 'Card needs a title and an href.');
        if (items.length < 1) this.issues.push({ code: 'invalid_component', line, col, message: 'Cards needs 1 or more Card items.' });
        for (const c of items) {
          if (!c.title || !c.href) continue;
          const use = parseInternalTarget(c.href);
          if (use) this.cards.push({ href: c.href, path: use.path, anchor: use.anchor, line: c.line, col: 0 });
        }
        return { kind: 'cards', line, cards: items, trailing };
      }
      case 'TryIt': {
        this.i++;
        const operationId = attrs.get('operationId') ?? '';
        return { kind: 'try-it', line, operationId };
      }
      case 'CodeGroup': {
        const inner = this.parseBlocks(['CodeGroup']);
        const blocks: CodeItem[] = [];
        const trailing: Block[] = [];
        for (const b of inner) {
          if (b.kind === 'code') blocks.push({ lang: b.lang, title: b.title, text: b.text, line: b.line });
          else trailing.push(b);
        }
        const titled = blocks.filter((b) => b.title);
        if (titled.length < 2) this.issues.push({ code: 'invalid_component', line, col, message: 'CodeGroup needs 2 or more titled code blocks.' });
        const seen = new Set<string>();
        for (const b of titled) {
          if (seen.has(b.title!)) this.issues.push({ code: 'invalid_component', line: b.line, col: 0, message: `Code block title "${b.title}" is used twice in this CodeGroup.` });
          seen.add(b.title!);
        }
        return { kind: 'code-group', line, blocks, trailing };
      }
      default: {
        const children = this.parseBlocks([name]);
        return { kind: 'callout', type: 'note', line, children };
      }
    }
  }

  private parseItems<T>(
    container: string, item: string,
    make: (attrs: Attrs, line: number, children: Block[]) => T,
    needsMessage: string,
  ): { items: T[]; trailing: Block[] } {
    const items: T[] = [];
    const trailing: Block[] = [];
    while (this.i < this.total()) {
      const raw = this.line();
      const trimmed = raw.trim();
      if (trimmed === `</${container}>`) { this.i++; return { items, trailing }; }
      if (trimmed === '') { this.i++; continue; }
      const t = trimmed.match(TAG_RE);
      if (t && t[1] === '' && t[2] === item) {
        const line = this.i + 1;
        const attrs = parseAttrs(t[3]);
        this.i++;
        const children = this.parseBlocks([item, container]);
        const needs = item === 'Card' ? !attrs.get('title') || !attrs.get('href') : !attrs.get('title');
        if (needs) this.issues.push({ code: 'invalid_component', line, col: 0, message: needsMessage });
        items.push(make(attrs, line, children));
        continue;
      }
      const sub = this.parseBlocks([container, item]);
      if (sub.length === 0) { this.i++; continue; }
      trailing.push(...sub);
    }
    this.issues.push({ code: 'invalid_component', line: items.length > 0 ? (items[0] as { line: number }).line : 0, col: 0, message: `${container} is missing its closing tag.` });
    return { items, trailing };
  }

  private parseOrphanItem(name: string, attrs: Attrs, col: number): Block[] {
    const line = this.i + 1;
    this.i++;
    const children = this.parseBlocks([name]);
    this.issues.push({
      code: 'invalid_component', line, col,
      message: name === 'Tab' ? 'Tab must be inside Tabs.' : name === 'Step' ? 'Step must be inside Steps.' : 'Card must be inside Cards.',
    });
    if (name === 'Card') {
      const href = attrs.get('href') ?? '';
      const use = parseInternalTarget(href);
      if (use) this.cards.push({ href, path: use.path, anchor: use.anchor, line, col });
    }
    return children;
  }

  addLink(use: LinkUse): void { this.links.push(use); }
  addImage(use: ImageUse): void { this.images.push(use); }
}

function parseInternalTarget(target: string): { path: string; anchor: string | null } | null {
  if (!target.startsWith('/')) return null;
  const hash = target.indexOf('#');
  const path = hash === -1 ? target.slice(1) : target.slice(1, hash);
  if (path === '' ) return null;
  return { path, anchor: hash === -1 ? null : target.slice(hash + 1) };
}

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]*\]\([^)]+\))/g;

export function parseInlines(text: string, line: number, parser: Parser | null): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const baseCol = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push({ kind: 'code', text: tok.slice(1, -1) });
    } else if (tok.startsWith('**')) {
      out.push({ kind: 'strong', children: [{ kind: 'text', text: tok.slice(2, -2) }] });
    } else if (tok.startsWith('*')) {
      out.push({ kind: 'em', children: [{ kind: 'text', text: tok.slice(1, -1) }] });
    } else if (tok.startsWith('![')) {
      const close = tok.indexOf('](');
      const alt = tok.slice(2, close);
      const url = tok.slice(close + 2, -1);
      out.push({ kind: 'image', alt, url, pos: { line, col: baseCol + m.index } });
      parser?.addImage({ url, line, col: m.index });
    } else {
      const close = tok.indexOf('](');
      const linkText = tok.slice(1, close);
      const target = tok.slice(close + 2, -1);
      const targetCol = m.index + (tok.indexOf('(' + target + ')') >= 0 ? close + 2 : 0);
      out.push({ kind: 'link', text: linkText, target, pos: { line, col: m.index }, targetCol, targetEndCol: targetCol + target.length });
      const use = parseInternalTarget(target);
      if (use) {
        parser?.addLink({ path: use.path, anchor: use.anchor, target, line, col: m.index, targetCol, targetEndCol: targetCol + target.length });
      } else if (target.startsWith('#')) {
        parser?.addLink({ path: null, anchor: target.slice(1), target, line, col: m.index, targetCol, targetEndCol: targetCol + target.length });
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function parsePage(source: string): ParsedPage {
  const parser = new Parser(source);
  const blocks = parser.run();
  assignHeadingAnchors(blocks, parser);
  return { blocks, issues: parser.issues, links: parser.links, images: parser.images, cards: parser.cards };
}

function assignHeadingAnchors(blocks: Block[], parser: Parser): void {
  const counts = new Map<string, number>();
  walkHeadings(blocks, (h) => {
    if (h.level !== 2 && h.level !== 3) { h.anchor = null; return; }
    const base = anchorSlug(h.text);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    h.anchor = n === 0 ? base : `${base}-${n + 1}`;
  });
  void parser;
}

export function walkHeadings(blocks: Block[], visit: (h: Extract<Block, { kind: 'heading' }>) => void): void {
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': visit(b); break;
      case 'callout': case 'accordion': walkHeadings(b.children, visit); break;
      case 'tabs': for (const t of b.tabs) walkHeadings(t.children, visit); walkHeadings(b.trailing, visit); break;
      case 'steps': for (const s of b.steps) walkHeadings(s.children, visit); walkHeadings(b.trailing, visit); break;
      case 'cards': for (const c of b.cards) walkHeadings(c.children, visit); walkHeadings(b.trailing, visit); break;
      default: break;
    }
  }
}

export function anchorSlug(headingText: string): string {
  const lowered = headingText.toLowerCase();
  let slug = '';
  let lastDash = false;
  for (const ch of lowered) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) { slug += ch; lastDash = false; }
    else if (!lastDash) { slug += '-'; lastDash = true; }
  }
  slug = slug.replace(/^-+|-+$/g, '');
  return slug === '' ? 'section' : slug;
}

export function plainTextOfInlines(inlines: Inline[]): string {
  let out = '';
  for (const i of inlines) {
    if (i.kind === 'text' || i.kind === 'code') out += i.text;
    else if (i.kind === 'em' || i.kind === 'strong') out += plainTextOfInlines(i.children);
    else if (i.kind === 'link') out += i.text;
    else if (i.kind === 'image') out += i.alt;
  }
  return out;
}
