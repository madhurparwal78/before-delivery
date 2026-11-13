import { uniqueAnchors } from './anchors';
import { gateMessages, readerMessages } from './messages';

/** The page-source engine: the CommonMark subset plus the six published components. */

export const COMPONENT_NAMES = [
  'Callout',
  'Tabs',
  'Tab',
  'CodeGroup',
  'Steps',
  'Step',
  'Accordion',
  'Cards',
  'Card',
] as const;

export type ComponentName = (typeof COMPONENT_NAMES)[number];

const CONTAINER_OF: Readonly<Record<string, ComponentName>> = {
  Tab: 'Tabs',
  Step: 'Steps',
  Card: 'Cards',
};

export type Inline =
  | { k: 'text'; text: string }
  | { k: 'code'; text: string }
  | { k: 'em'; kids: Inline[] }
  | { k: 'strong'; kids: Inline[] }
  | { k: 'link'; target: string; kids: Inline[] }
  | { k: 'image'; alt: string; src: string };

export type Block =
  | { k: 'heading'; level: number; text: string; inline: Inline[]; line: number }
  | { k: 'paragraph'; inline: Inline[]; line: number }
  | { k: 'list'; ordered: boolean; items: Inline[][]; line: number }
  | { k: 'code'; language: string; title: string; code: string; line: number }
  | { k: 'raw'; text: string; line: number }
  | {
      k: 'component';
      name: ComponentName;
      attrs: Readonly<Record<string, string>>;
      kids: Block[];
      line: number;
    };

export interface LinkRef {
  line: number;
  column: number;
  target: string;
  length: number;
}

export interface ImageRef {
  line: number;
  column: number;
  src: string;
}

export interface SourceProblem {
  line: number;
  column: number;
  code: 'unknown_component' | 'invalid_component';
  message: string;
}

export interface HeadingInfo {
  level: number;
  text: string;
  anchor: string | null;
}

export interface ParsedPage {
  blocks: Block[];
  links: LinkRef[];
  images: ImageRef[];
  problems: SourceProblem[];
  headings: HeadingInfo[];
}

interface Collector {
  links: LinkRef[];
  images: ImageRef[];
  problems: SourceProblem[];
}

const TAG_OPEN = /^<([A-Z][A-Za-z0-9]*)((?:\s+[A-Za-z-]+="[^"]*")*)\s*>\s*$/;
const TAG_CLOSE = /^<\/([A-Z][A-Za-z0-9]*)>\s*$/;
const FENCE = /^(```+)(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;

const isKnown = (name: string): name is ComponentName =>
  (COMPONENT_NAMES as readonly string[]).includes(name);

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([A-Za-z-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

interface LinkMatch {
  labelStart: number;
  labelEnd: number;
  targetStart: number;
  target: string;
  end: number;
}

function matchLink(text: string, start: number): LinkMatch | null {
  if (text[start] !== '[') return null;
  let depth = 0;
  let labelEnd = -1;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        labelEnd = i;
        break;
      }
    }
  }
  if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null;
  const close = text.indexOf(')', labelEnd + 2);
  if (close < 0) return null;
  const inside = text.slice(labelEnd + 2, close);
  const space = inside.search(/\s/);
  const target = space < 0 ? inside : inside.slice(0, space);
  return {
    labelStart: start + 1,
    labelEnd,
    targetStart: labelEnd + 2,
    target,
    end: close + 1,
  };
}

function parseInline(
  text: string,
  line: number,
  baseColumn: number,
  collect: Collector,
  allowLinks: boolean,
): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') {
      out.push({ k: 'text', text: buffer });
      buffer = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ k: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (char === '!' && text[i + 1] === '[') {
      const match = matchLink(text, i + 1);
      if (match !== null) {
        flush();
        collect.images.push({ line, column: baseColumn + match.targetStart, src: match.target });
        out.push({ k: 'image', alt: text.slice(match.labelStart, match.labelEnd), src: match.target });
        i = match.end;
        continue;
      }
    }
    if (char === '[') {
      const match = matchLink(text, i);
      if (match !== null) {
        flush();
        const kids = parseInline(
          text.slice(match.labelStart, match.labelEnd),
          line,
          baseColumn + match.labelStart,
          collect,
          false,
        );
        if (allowLinks) {
          collect.links.push({
            line,
            column: baseColumn + match.targetStart,
            target: match.target,
            length: match.target.length,
          });
          out.push({ k: 'link', target: match.target, kids });
        } else {
          out.push(...kids);
        }
        i = match.end;
        continue;
      }
    }
    if (char === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({
          k: 'strong',
          kids: parseInline(text.slice(i + 2, end), line, baseColumn + i + 2, collect, allowLinks),
        });
        i = end + 2;
        continue;
      }
    }
    if ((char === '*' || char === '_') && text[i + 1] !== undefined && !/\s/.test(text[i + 1])) {
      const end = text.indexOf(char, i + 1);
      if (end > i + 1) {
        flush();
        out.push({
          k: 'em',
          kids: parseInline(text.slice(i + 1, end), line, baseColumn + i + 1, collect, allowLinks),
        });
        i = end + 1;
        continue;
      }
    }
    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

const inlineText = (nodes: readonly Inline[]): string =>
  nodes
    .map((node) => {
      switch (node.k) {
        case 'text':
        case 'code':
          return node.text;
        case 'image':
          return node.alt;
        case 'em':
        case 'strong':
        case 'link':
          return inlineText(node.kids);
      }
    })
    .join('');

function findClose(lines: readonly string[], name: string, from: number, to: number): number {
  let depth = 0;
  for (let i = from; i < to; i += 1) {
    const open = TAG_OPEN.exec(lines[i]);
    if (open !== null && open[1] === name) {
      depth += 1;
      continue;
    }
    const close = TAG_CLOSE.exec(lines[i]);
    if (close !== null && close[1] === name) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseBlocks(
  lines: readonly string[],
  from: number,
  to: number,
  collect: Collector,
  parent: ComponentName | null,
): Block[] {
  const blocks: Block[] = [];
  let i = from;
  while (i < to) {
    const raw = lines[i];
    const line = i + 1;
    if (raw.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(raw);
    if (fence !== null) {
      const marker = fence[1];
      let end = i + 1;
      while (end < to && !lines[end].startsWith(marker)) end += 1;
      const info = fence[2].trim();
      const space = info.indexOf(' ');
      blocks.push({
        k: 'code',
        language: space < 0 ? info : info.slice(0, space),
        title: space < 0 ? '' : info.slice(space + 1).trim(),
        code: lines.slice(i + 1, end).join('\n'),
        line,
      });
      i = end + 1;
      continue;
    }
    const open = TAG_OPEN.exec(raw);
    if (open !== null) {
      const name = open[1];
      if (!isKnown(name)) {
        collect.problems.push({
          line,
          column: 0,
          code: 'unknown_component',
          message: gateMessages.unknownComponent(name),
        });
        blocks.push({ k: 'raw', text: raw, line });
        i += 1;
        continue;
      }
      const close = findClose(lines, name, i, to);
      const childTo = close < 0 ? to : close;
      if (close < 0) {
        collect.problems.push({
          line,
          column: 0,
          code: 'invalid_component',
          message: gateMessages.missingClosingTag(name),
        });
      }
      const attrs = parseAttrs(open[2]);
      const kids = parseBlocks(lines, i + 1, childTo, collect, name);
      const block: Block = { k: 'component', name, attrs, kids, line };
      if (name === 'Card' && attrs.href !== undefined) {
        collect.links.push({
          line,
          column: raw.indexOf('href="') + 'href="'.length,
          target: attrs.href,
          length: attrs.href.length,
        });
      }
      validateComponent(block, parent, collect);
      blocks.push(block);
      i = (close < 0 ? to : close) + 1;
      continue;
    }
    if (TAG_CLOSE.test(raw) || /^<[A-Z]/.test(raw.trim())) {
      blocks.push({ k: 'raw', text: raw, line });
      i += 1;
      continue;
    }
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      const inline = parseInline(heading[2], line, heading[1].length + 1, collect, true);
      blocks.push({
        k: 'heading',
        level: heading[1].length === 1 ? 2 : heading[1].length,
        text: inlineText(inline),
        inline,
        line,
      });
      i += 1;
      continue;
    }
    const bullet = BULLET.exec(raw);
    const ordered = ORDERED.exec(raw);
    if (bullet !== null || ordered !== null) {
      const isOrdered = bullet === null;
      const items: Inline[][] = [];
      let j = i;
      while (j < to) {
        const match = isOrdered ? ORDERED.exec(lines[j]) : BULLET.exec(lines[j]);
        if (match === null) break;
        const offset = lines[j].length - match[1].length;
        items.push(parseInline(match[1], j + 1, offset, collect, true));
        j += 1;
      }
      blocks.push({ k: 'list', ordered: isOrdered, items, line });
      i = j;
      continue;
    }
    const paragraph: Inline[] = [];
    let j = i;
    while (j < to) {
      const text = lines[j];
      const startsBlock =
        text.trim() === '' ||
        FENCE.test(text) ||
        HEADING.test(text) ||
        BULLET.test(text) ||
        ORDERED.test(text) ||
        /^<\/?[A-Z]/.test(text.trim());
      if (j > i && startsBlock) break;
      if (j > i) paragraph.push({ k: 'text', text: '\n' });
      paragraph.push(...parseInline(text, j + 1, 0, collect, true));
      j += 1;
    }
    blocks.push({ k: 'paragraph', inline: paragraph, line });
    i = j;
  }
  return blocks;
}

/** Every component rule from the components table, decided here. */
function validateComponent(
  block: Extract<Block, { k: 'component' }>,
  parent: ComponentName | null,
  collect: Collector,
): void {
  const add = (message: string, line = block.line): void => {
    collect.problems.push({ line, column: 0, code: 'invalid_component', message });
  };
  const container = CONTAINER_OF[block.name];
  if (container !== undefined && parent !== container) {
    add(
      block.name === 'Tab'
        ? gateMessages.tabOutside
        : block.name === 'Step'
          ? gateMessages.stepOutside
          : gateMessages.cardOutside,
    );
  }
  const children = (name: ComponentName): Extract<Block, { k: 'component' }>[] =>
    block.kids.filter(
      (kid): kid is Extract<Block, { k: 'component' }> => kid.k === 'component' && kid.name === name,
    );
  switch (block.name) {
    case 'Callout': {
      const type = block.attrs.type;
      if (type !== 'note' && type !== 'tip' && type !== 'warning' && type !== 'danger') {
        add(gateMessages.calloutType);
      }
      break;
    }
    case 'Tabs': {
      const tabs = children('Tab');
      if (tabs.length < 2) add(gateMessages.tabsCount);
      const seen = new Set<string>();
      for (const tab of tabs) {
        const title = tab.attrs.title;
        if (title === undefined || title === '') continue;
        if (seen.has(title)) add(gateMessages.tabTitleDuplicate(title), tab.line);
        seen.add(title);
      }
      break;
    }
    case 'Tab': {
      if (block.attrs.title === undefined || block.attrs.title === '') add(gateMessages.tabTitle);
      break;
    }
    case 'CodeGroup': {
      const codes = block.kids.filter(
        (kid): kid is Extract<Block, { k: 'code' }> => kid.k === 'code' && kid.title !== '',
      );
      if (codes.length < 2) add(gateMessages.codeGroupCount);
      const seen = new Set<string>();
      for (const code of codes) {
        if (seen.has(code.title)) add(gateMessages.codeTitleDuplicate(code.title), code.line);
        seen.add(code.title);
      }
      break;
    }
    case 'Steps': {
      if (children('Step').length < 1) add(gateMessages.stepsCount);
      break;
    }
    case 'Step': {
      if (block.attrs.title === undefined || block.attrs.title === '') add(gateMessages.stepTitle);
      break;
    }
    case 'Accordion': {
      if (block.attrs.title === undefined || block.attrs.title === '') {
        add(gateMessages.accordionTitle);
      }
      break;
    }
    case 'Cards': {
      if (children('Card').length < 1) add(gateMessages.cardsCount);
      break;
    }
    case 'Card': {
      const { title, href } = block.attrs;
      if (title === undefined || title === '' || href === undefined || href === '') {
        add(gateMessages.cardAttributes);
      } else if (!href.startsWith('/') && !href.startsWith('#')) {
        add(gateMessages.cardAttributes);
      }
      break;
    }
  }
}

export function parsePage(source: string): ParsedPage {
  const lines = source.split('\n');
  const collect: Collector = { links: [], images: [], problems: [] };
  const blocks = parseBlocks(lines, 0, lines.length, collect, null);
  const headings = collectHeadings(blocks);
  collect.links.sort((a, b) => a.line - b.line || a.column - b.column);
  return { blocks, headings, links: collect.links, images: collect.images, problems: collect.problems };
}

function collectHeadings(blocks: readonly Block[]): HeadingInfo[] {
  const found: { level: number; text: string }[] = [];
  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      if (block.k === 'heading') found.push({ level: block.level, text: block.text });
      else if (block.k === 'component') walk(block.kids);
    }
  };
  walk(blocks);
  const anchorable = found.filter((heading) => heading.level === 2 || heading.level === 3);
  const anchors = uniqueAnchors(anchorable.map((heading) => heading.text));
  let next = 0;
  return found.map((heading) => ({
    level: heading.level,
    text: heading.text,
    anchor: heading.level === 2 || heading.level === 3 ? anchors[next++] : null,
  }));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderContext {
  siteSlug: string;
  versionSlug: string;
}

export interface RenderedPage {
  html: string;
  text: string;
  headings: HeadingInfo[];
}

const EXTERNAL = /^(https?:|mailto:)/;

export function internalHref(ctx: RenderContext, target: string): string {
  const [path, anchor] = target.split('#');
  const base = `/docs/${ctx.siteSlug}/${ctx.versionSlug}${path}`;
  return anchor === undefined ? base : `${base}#${anchor}`;
}

class Renderer {
  private counter = 0;
  private readonly textParts: string[] = [];

  constructor(private readonly ctx: RenderContext) {}

  nextId(): string {
    this.counter += 1;
    return `c${this.counter}`;
  }

  text(value: string): void {
    if (value.trim() !== '') this.textParts.push(value.trim());
  }

  plainText(): string {
    return this.textParts.join(' ');
  }

  inline(nodes: readonly Inline[], flattenLinks = false): string {
    return nodes
      .map((node) => {
        switch (node.k) {
          case 'text':
            this.text(node.text);
            return escapeHtml(node.text);
          case 'code':
            this.text(node.text);
            return `<code>${escapeHtml(node.text)}</code>`;
          case 'em':
            return `<em>${this.inline(node.kids, flattenLinks)}</em>`;
          case 'strong':
            return `<strong>${this.inline(node.kids, flattenLinks)}</strong>`;
          case 'image':
            return this.image(node);
          case 'link':
            return this.link(node, flattenLinks);
        }
      })
      .join('');
  }

  private image(node: Extract<Inline, { k: 'image' }>): string {
    this.text(node.alt);
    if (!node.src.startsWith(`/assets/${this.ctx.siteSlug}/`)) return escapeHtml(node.alt);
    return `<img src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}">`;
  }

  private link(node: Extract<Inline, { k: 'link' }>, flatten: boolean): string {
    const body = this.inline(node.kids, flatten);
    if (flatten) return body;
    const target = node.target;
    if (target.startsWith('/')) {
      return `<a href="${escapeHtml(internalHref(this.ctx, target))}">${body}</a>`;
    }
    if (target.startsWith('#')) return `<a href="${escapeHtml(target)}">${body}</a>`;
    if (EXTERNAL.test(target)) return `<a href="${escapeHtml(target)}" rel="noreferrer">${body}</a>`;
    return body;
  }

  blocks(list: readonly Block[], headings: Iterator<HeadingInfo>): string {
    return list.map((block) => this.block(block, headings)).join('\n');
  }

  private block(block: Block, headings: Iterator<HeadingInfo>): string {
    switch (block.k) {
      case 'heading': {
        const info = headings.next().value as HeadingInfo;
        const level = Math.min(Math.max(block.level, 2), 6);
        const body = this.inline(block.inline);
        if (info.anchor === null) return `<h${level}>${body}</h${level}>`;
        return `<div class="heading-row"><h${level} id="${escapeHtml(info.anchor)}">${body}</h${level}><a class="anchor-link" href="#${escapeHtml(info.anchor)}" aria-label="Link to ${escapeHtml(info.text)}">#</a></div>`;
      }
      case 'paragraph':
        return `<p>${this.inline(block.inline)}</p>`;
      case 'list': {
        const items = block.items.map((item) => `<li>${this.inline(item)}</li>`).join('');
        return block.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
      }
      case 'code':
        this.text(block.code);
        return `<div class="code-block"><pre><code${block.language === '' ? '' : ` class="language-${escapeHtml(block.language)}"`}>${escapeHtml(block.code)}</code></pre></div>`;
      case 'raw':
        this.text(block.text);
        return `<p>${escapeHtml(block.text)}</p>`;
      case 'component':
        return this.component(block, headings);
    }
  }

  private component(
    block: Extract<Block, { k: 'component' }>,
    headings: Iterator<HeadingInfo>,
  ): string {
    switch (block.name) {
      case 'Callout': {
        const type = block.attrs.type ?? 'note';
        const label = type.charAt(0).toUpperCase() + type.slice(1);
        return `<aside role="note" aria-label="${escapeHtml(label)}" data-component="callout" data-type="${escapeHtml(type)}">${this.blocks(block.kids, headings)}</aside>`;
      }
      case 'Tabs':
        return this.tabs(block, headings);
      case 'CodeGroup':
        return this.codeGroup(block);
      case 'Steps': {
        const steps = block.kids.filter(
          (kid): kid is Extract<Block, { k: 'component' }> =>
            kid.k === 'component' && kid.name === 'Step',
        );
        const items = steps
          .map((step, index) => {
            const title = readerMessages.stepHeading(index + 1, step.attrs.title ?? '');
            this.text(title);
            return `<li><h3 class="step-heading">${escapeHtml(title)}</h3>${this.blocks(step.kids, headings)}</li>`;
          })
          .join('');
        return `<ol data-component="steps" class="steps">${items}</ol>`;
      }
      case 'Accordion': {
        const id = this.nextId();
        const title = block.attrs.title ?? '';
        this.text(title);
        return `<div data-component="accordion" class="accordion"><button type="button" class="accordion-button" aria-expanded="false" aria-controls="${id}-r">${escapeHtml(title)}</button><div id="${id}-r" class="accordion-region" data-motion="closed" hidden>${this.blocks(block.kids, headings)}</div></div>`;
      }
      case 'Cards': {
        const cards = block.kids.filter(
          (kid): kid is Extract<Block, { k: 'component' }> =>
            kid.k === 'component' && kid.name === 'Card',
        );
        const items = cards
          .map((card) => {
            const title = card.attrs.title ?? '';
            const href = card.attrs.href ?? '';
            this.text(title);
            const target = href.startsWith('/') ? internalHref(this.ctx, href) : href;
            const body = card.kids
              .map((kid) =>
                kid.k === 'paragraph' ? `<span class="card-text">${this.inline(kid.inline, true)}</span>` : '',
              )
              .join('');
            return `<li><a class="card" href="${escapeHtml(target)}" aria-label="${escapeHtml(title)}"><span class="card-title">${escapeHtml(title)}</span>${body}</a></li>`;
          })
          .join('');
        return `<ul data-component="cards" class="cards">${items}</ul>`;
      }
      case 'Tab':
      case 'Step':
      case 'Card':
        return this.blocks(block.kids, headings);
    }
  }

  private tabs(block: Extract<Block, { k: 'component' }>, headings: Iterator<HeadingInfo>): string {
    const id = this.nextId();
    const tabs = block.kids.filter(
      (kid): kid is Extract<Block, { k: 'component' }> =>
        kid.k === 'component' && kid.name === 'Tab',
    );
    const buttons = tabs
      .map((tab, index) => {
        const title = tab.attrs.title ?? '';
        this.text(title);
        return `<button type="button" role="tab" id="${id}-t${index}" aria-selected="${index === 0}" aria-controls="${id}-p${index}" tabindex="${index === 0 ? 0 : -1}">${escapeHtml(title)}</button>`;
      })
      .join('');
    const panels = tabs
      .map(
        (tab, index) =>
          `<div role="tabpanel" id="${id}-p${index}" aria-labelledby="${id}-t${index}"${index === 0 ? '' : ' hidden'}>${this.blocks(tab.kids, headings)}</div>`,
      )
      .join('');
    return `<div data-component="tabs" class="tabs"><div role="tablist" class="tablist">${buttons}</div>${panels}</div>`;
  }

  private codeGroup(block: Extract<Block, { k: 'component' }>): string {
    const id = this.nextId();
    const codes = block.kids.filter(
      (kid): kid is Extract<Block, { k: 'code' }> => kid.k === 'code',
    );
    const buttons = codes
      .map(
        (code, index) =>
          `<button type="button" role="tab" id="${id}-t${index}" data-title="${escapeHtml(code.title)}" aria-selected="${index === 0}" aria-controls="${id}-p${index}" tabindex="${index === 0 ? 0 : -1}">${escapeHtml(code.title)}</button>`,
      )
      .join('');
    const panels = codes
      .map((code, index) => {
        this.text(code.code);
        return `<div role="tabpanel" id="${id}-p${index}" aria-labelledby="${id}-t${index}"${index === 0 ? '' : ' hidden'}><div class="code-top"><button type="button" class="copy-button">Copy</button></div><pre><code${code.language === '' ? '' : ` class="language-${escapeHtml(code.language)}"`}>${escapeHtml(code.code)}</code></pre></div>`;
      })
      .join('');
    return `<div data-component="code-group" class="code-group"><div role="tablist" aria-label="Code examples" class="tablist">${buttons}</div>${panels}</div>`;
  }
}

export function renderPage(parsed: ParsedPage, ctx: RenderContext): RenderedPage {
  const renderer = new Renderer(ctx);
  const headings = parsed.headings[Symbol.iterator]();
  const html = renderer.blocks(parsed.blocks, headings);
  return { html, text: renderer.plainText(), headings: parsed.headings };
}

/** Rewrites every internal link and Card href whose path is exactly the old path (DP-13). */
export function rewriteLinks(
  source: string,
  oldPath: string,
  newPath: string,
): { source: string; count: number } {
  const parsed = parsePage(source);
  const lines = source.split('\n');
  let count = 0;
  const byLine = new Map<number, LinkRef[]>();
  for (const link of parsed.links) {
    const [path] = link.target.split('#');
    if (path !== oldPath) continue;
    const list = byLine.get(link.line) ?? [];
    list.push(link);
    byLine.set(link.line, list);
  }
  for (const [line, refs] of byLine) {
    let text = lines[line - 1];
    for (const ref of [...refs].sort((a, b) => b.column - a.column)) {
      const anchor = ref.target.includes('#') ? `#${ref.target.split('#').slice(1).join('#')}` : '';
      const replacement = `${newPath}${anchor}`;
      text = text.slice(0, ref.column) + replacement + text.slice(ref.column + ref.length);
      count += 1;
    }
    lines[line - 1] = text;
  }
  return { source: lines.join('\n'), count };
}
