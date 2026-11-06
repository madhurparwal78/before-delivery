import { h, roleLabel } from './lib/dom.js';
import { emptyModel, applyTextInsert, applyTextDelete, applyMarkDelta, applyStyleDelta, modelBlocks, type DocModel, type TextDelta } from '../domain/model.js';
import type { BlockStyle, MarkType } from '../domain/ot.js';

export type CardPerson = { personId: string; displayName: string; colour: string; role?: string };
export type CardSpan = { at: number; length: number };
export type UICard =
  | {
      kind: 'suggestion';
      id: string;
      temp: boolean;
      author: CardPerson;
      sug: { id: string; kind: 'insert' | 'delete' | 'replace'; inserted: CardSpan | null; deleted: CardSpan | null; contentDeleted: boolean; status: string };
    }
  | {
      kind: 'comment';
      id: string;
      author: CardPerson;
      mentions: CardPerson[];
      ref: { id: string; body: string; anchor: CardSpan | null; contentDeleted: boolean; status: string; replies: { id: string; authorId: string; body: string; createdAt: string }[] };
    };

export type RemoteCaret = { person: CardPerson; at: number; length: number; idle: boolean };

/** The browser's mirror of the document: the same model code the server uses. */
export class PageModel {
  blocks(): { style: string; at: number; length: number }[] {
    return modelBlocks(this.model);
  }

  model: DocModel;
  cards: UICard[] = [];
  carets: Map<string, RemoteCaret> = new Map();

  constructor(text = '', lineStyles: BlockStyle[] = [], marks: { type: MarkType; at: number; length: number; href?: string }[] = []) {
    this.model = emptyModel();
    this.model.text = text;
    this.model.lineStyles = lineStyles;
    this.model.marks = marks;
  }

  applyTextOps(ops: TextDelta[]): void {
    for (const op of ops) {
      if ('ins' in op) applyTextInsert(this.model, op.at, op.ins);
      else if ('del' in op) applyTextDelete(this.model, op.at, op.del);
      else if ('mark' in op) applyMarkDelta(this.model, op);
      else if ('style' in op) applyStyleDelta(this.model, op);
    }
  }

  wordCount(): number {
    let text = this.model.text;
    const openInsertions = this.model.suggestions
      .filter((s) => s.status === 'open' && s.inserted)
      .map((s) => s.inserted!)
      .sort((a, b) => b.at - a.at);
    for (const span of openInsertions) {
      text = text.slice(0, span.at) + ' '.repeat(span.length) + text.slice(span.at + span.length);
    }
    return text.split(/\s+/).filter((w) => /\S/.test(w)).length;
  }
}

export type RenderContext = {
  pageEl: HTMLElement;
  model: PageModel;
  myPersonId: string;
  isPhone: () => boolean;
  findQuery: string | null;
  matchCase: boolean;
  focusedCardId: string | null;
  onCardFocus: (id: string | null) => void;
  markerNumbers: Map<string, number>;
};

/** Builds the spans for one block line: marks, suggestion decorations, anchors, carets, find highlights. */
function buildLine(
  text: string,
  lineStart: number,
  style: string,
  ctx: RenderContext,
  lineIndex: number,
): HTMLElement {
  const line = h('div', { class: `block block-${style}`, 'data-line': lineIndex });
  const decorations: { start: number; end: number; cls: string; color?: string; dataAnchor?: string; dataCaret?: string; label?: string | null; underline?: boolean; linkHref?: string }[] = [];

  const model = ctx.model.model;
  for (const mark of model.marks) {
    const cls = `mark-${mark.type}`;
    decorations.push({ start: mark.at, end: mark.at + mark.length, cls, underline: true, linkHref: mark.href });
  }
  for (const card of ctx.model.cards) {
    if (card.kind === 'suggestion') {
      const color = card.author.colour;
      if (card.sug.inserted && card.sug.inserted.length > 0) {
        decorations.push({ start: card.sug.inserted.at, end: card.sug.inserted.at + card.sug.inserted.length, cls: 'suggestion-insert', color, dataAnchor: card.id, underline: true });
      }
      if (card.sug.deleted && card.sug.deleted.length > 0) {
        decorations.push({ start: card.sug.deleted.at, end: card.sug.deleted.at + card.sug.deleted.length, cls: 'suggestion-delete', color, dataAnchor: card.id });
      }
    } else if (card.ref.anchor && card.ref.anchor.length > 0) {
      decorations.push({ start: card.ref.anchor.at, end: card.ref.anchor.at + card.ref.anchor.length, cls: 'anchor-range', color: card.author.colour, dataAnchor: card.id });
    }
  }
  for (const [pid, caret] of ctx.model.carets) {
    if (pid === ctx.myPersonId) continue;
    decorations.push({ start: caret.at, end: caret.at + Math.max(caret.length, 0), cls: 'remote-caret-holder', color: caret.person.colour, dataCaret: pid, label: caret.idle ? null : caret.person.displayName });
  }
  if (ctx.findQuery && ctx.findQuery.length > 0) {
    const hay = ctx.matchCase ? text : text.toLowerCase();
    const needle = ctx.matchCase ? ctx.findQuery : ctx.findQuery.toLowerCase();
    let idx = 0;
    while (idx + needle.length <= hay.length) {
      const found = hay.indexOf(needle, idx);
      if (found === -1) break;
      decorations.push({ start: found, end: found + needle.length, cls: 'find-match' });
      idx = found + needle.length;
    }
  }

  // clip decorations to this line
  const lineEnd = lineStart + text.length + 1;
  const clipped = decorations
    .filter((d) => d.end > lineStart && d.start < lineEnd)
    .map((d) => ({ ...d, start: Math.max(d.start, lineStart), end: Math.min(d.end, lineStart + text.length) }))
    .filter((d) => d.end > d.start || d.cls === 'remote-caret-holder');

  // zero-length carets land exactly on a boundary and render as empty markers
  const caretDecorations = clipped.filter((d) => d.cls === 'remote-caret-holder' && d.end === d.start);
  const bodyDecorations = clipped.filter((d) => d.end > d.start);

  // build segment boundaries
  const points = new Set<number>([0, text.length]);
  for (const d of clipped) {
    points.add(Math.max(0, Math.min(d.start - lineStart, text.length)));
    points.add(Math.max(0, Math.min(d.end - lineStart, text.length)));
  }
  const stops = [...points].sort((a, b) => a - b);

  const appendCaretsAt = (localOffset: number): void => {
    for (const d of caretDecorations) {
      if (d.start - lineStart !== localOffset) continue;
      const label = d.label;
      const marker = h('span', { class: 'remote-caret', 'data-caret-for': d.dataCaret ?? '', style: `border-right:2px solid ${d.color}` });
      if (label) marker.append(h('span', { class: 'caret-label', style: `background:${d.color}`, text: label }));
      line.append(marker);
    }
  };

  for (let i = 0; i < stops.length - 1; i += 1) {
    const start = lineStart + stops[i]!;
    const end = lineStart + stops[i + 1]!;
    appendCaretsAt(stops[i]!);
    if (end <= start) continue;
    const active = bodyDecorations.filter((d) => d.start <= start && d.end >= end);
    let node: Node = document.createTextNode(text.slice(stops[i], stops[i + 1]));
    const colorSet = active.filter((d) => d.color);
    const anchorSet = active.filter((d) => d.dataAnchor);
    const caretSet = active.filter((d) => d.dataCaret);
    const color = colorSet[colorSet.length - 1]?.color;
    const anchorId = anchorSet[anchorSet.length - 1]?.dataAnchor;
    if (anchorId && color) {
      const span = h('span', { class: 'anchor-range', style: `border-color:${color};background:${color}1a`, 'data-anchor-for': anchorId });
      span.append(node);
      node = span;
    }
    const seg: HTMLElement[] = [];
    for (const d of active) {
      if (d.cls === 'suggestion-insert') {
        const span = h('span', { class: 'suggestion-insert', style: `border-bottom:2px solid ${color}`, 'data-anchor-for': d.dataAnchor ?? '' });
        span.append(node);
        node = span;
      } else if (d.cls === 'suggestion-delete') {
        const span = h('del', { class: 'suggestion-delete', style: `text-decoration:line-through 2px ${color}`, 'data-anchor-for': d.dataAnchor ?? '' });
        span.append(node);
        node = span;
      } else if (d.cls.startsWith('mark-')) {
        const span = h(d.cls === 'mark-link' ? 'a' : 'span', {
          class: d.cls,
          ...(d.cls === 'mark-link' ? { href: (active.find((a) => a.cls === 'mark-link')?.linkHref ?? '#') } : {}),
        });
        span.append(node);
        node = span;
      }
      void seg;
    }
    if (color && !anchorId) {
      const wrap = h('span', { class: 'suggestion-insert', style: `border-bottom:2px solid ${color}` });
      wrap.append(node);
      node = wrap;
    }
    for (const d of caretSet) {
      const wrap = h('span', { class: 'remote-caret', 'data-caret-for': d.dataCaret ?? '', style: `border-right-color:${d.color}` });
      if (d.label) wrap.append(h('span', { class: 'caret-label', style: `background:${d.color}`, text: d.label }));
      wrap.append(node);
      node = wrap;
    }
    line.append(node);
  }

  // marker chips on the phone replace tethers
  appendCaretsAt(text.length);
  if (ctx.isPhone()) {
    const cardsForLine = ctx.model.cards.filter((c) => {
      const span = c.kind === 'suggestion' ? (c.sug.inserted ?? c.sug.deleted) : c.ref.anchor;
      return span && span.at >= lineStart && span.at < lineEnd;
    });
    let chipIdx = 0;
    for (const card of cardsForLine) {
      chipIdx += 1;
      const num = ctx.markerNumbers.get(card.id) ?? 1;
      const chip = h('button', {
        class: 'marker-chip',
        'data-marker-for': card.id,
        'aria-label': `Card ${num}`,
        text: String(num),
        type: 'button',
        style: 'color:inherit',
      });
      line.append(chip);
    }
  }
  return line;
}

export type PageView = {
  container: HTMLElement;
  render: () => void;
  offsetOf: (node: Node, offset: number) => number;
  positionOf: (index: number) => { node: Node; offset: number } | null;
  lineIndexAt: (index: number) => number;
};

/** Renders the proposal page: one block div per line, with all decorations. */
export function createPage(ctx: RenderContext): PageView {
  const container = h('div', { class: 'sheet' }) as HTMLElement;
  const render = (): void => {
    const model = ctx.model.model;
    const blocks = modelBlocks(model);
    container.textContent = '';
    const lines = model.text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const lineText = lines[i]!;
      const block = blocks[i] ?? { style: 'paragraph', at: 0, length: lineText.length };
      container.append(buildLine(lineText, block.at, block.style, ctx, i));
    }
    if (lines.length === 0) container.append(h('div', { class: 'block block-paragraph' }, h('br')));
  };
  render();
  return {
    container,
    render,
    offsetOf: (node: Node, offset: number): number => {
      // count UTF-16 positions from the start of the page
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let count = 0;
      let current: Node | null;
      while ((current = walker.nextNode())) {
        const len = current.textContent?.length ?? 0;
        if (current === node || (current.parentNode === node && node.nodeType === Node.ELEMENT_NODE)) {
          return count + offset;
        }
        if (node.contains(current)) {
          return count + offset;
        }
        count += len;
      }
      return count;
    },
    positionOf: (index: number): { node: Node; offset: number } | null => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let count = 0;
      let current: Node | null;
      while ((current = walker.nextNode())) {
        const len = current.textContent?.length ?? 0;
        if (index <= count + len) {
          return { node: current, offset: Math.max(0, index - count) };
        }
        count += len;
      }
      const last = container.lastElementChild;
      if (last) {
        const lastText = last.textContent?.length ?? 0;
        return { node: last, offset: Math.max(0, lastText) };
      }
      return null;
    },
    lineIndexAt: (index: number): number => {
      const text = ctx.model.model.text;
      let line = 0;
      for (let i = 0; i < index && i < text.length; i += 1) {
        if (text[i] === '\n') line += 1;
      }
      return line;
    },
  };
}

export function cardPerson(p: CardPerson): string {
  return `${p.displayName} · ${roleLabel(p.role ?? '')}`;
}
