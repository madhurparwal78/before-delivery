import { blocksOf } from '../../shared/doc.js';
import { shiftPosThrough } from '../../shared/ot.js';
import type { Block, MarkType, OpEntry, Span, TextEdit } from '../../shared/types.js';
import { append, clear, el } from '../dom.js';
import type { EditorSession } from './session.js';

const BLOCK_TAGS: Record<Block['style'], keyof HTMLElementTagNameMap> = {
  title: 'h1',
  heading1: 'h2',
  heading2: 'h3',
  heading3: 'h4',
  paragraph: 'p',
  bullet: 'p',
  numbered: 'p',
};

export const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function wordEndAfter(text: string, pos: number): number {
  let index = pos;
  if (index < text.length && WORD_CHARACTER.test(text[index] as string)) {
    while (index < text.length && WORD_CHARACTER.test(text[index] as string)) index += 1;
    return index;
  }
  while (index < text.length && !WORD_CHARACTER.test(text[index] as string)) index += 1;
  while (index < text.length && WORD_CHARACTER.test(text[index] as string)) index += 1;
  return index;
}

export function wordStartBefore(text: string, pos: number): number {
  let index = pos;
  if (index > 0 && WORD_CHARACTER.test(text[index - 1] as string)) {
    while (index > 0 && WORD_CHARACTER.test(text[index - 1] as string)) index -= 1;
    return index;
  }
  while (index > 0 && !WORD_CHARACTER.test(text[index - 1] as string)) index -= 1;
  while (index > 0 && WORD_CHARACTER.test(text[index - 1] as string)) index -= 1;
  return index;
}

interface RunSpec {
  at: number;
  length: number;
  marks: { type: MarkType; href?: string }[];
  insertionOf: { id: string; colour: string } | null;
  deletionOf: { id: string; colour: string } | null;
  anchors: string[];
  colour: string | null;
  match: 'none' | 'match' | 'current';
}

export interface PageDecorations {
  matches: Span[];
  currentMatch: number;
  markers: Map<string, number>;
  hiddenCommentIds: Set<string>;
  inkFade: Span[];
  focusedCardId: string | null;
}

export interface PageHooks {
  onSelectionChange: (selection: Span, focusAt: number) => void;
  onCardTarget: (cardId: string) => void;
  onMarkerActivate: (cardId: string) => void;
}

/** The sheet: one controlled contenteditable page whose text comes from the model. */
export class PageView {
  readonly element: HTMLElement;
  readonly caretLayer: HTMLElement;
  selection: Span = { at: 0, length: 0 };
  focusAt = 0;
  private decorations: PageDecorations = {
    matches: [],
    currentMatch: -1,
    markers: new Map(),
    hiddenCommentIds: new Set(),
    inkFade: [],
    focusedCardId: null,
  };

  constructor(
    private readonly session: EditorSession,
    private readonly hooks: PageHooks,
  ) {
    this.element = el('div', {
      class: 'page-body',
      contenteditable: 'true',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': 'Proposal body',
      spellcheck: 'false',
    });
    this.caretLayer = el('div', { class: 'caret-layer', 'aria-hidden': 'true' });
    session.onRemoteEdits((edits) => this.shiftSelection(edits));
    this.element.addEventListener('beforeinput', (event) => this.onBeforeInput(event as InputEvent));
    this.element.addEventListener('paste', (event) => this.onPaste(event as ClipboardEvent));
    this.element.addEventListener('cut', (event) => this.onCut(event as ClipboardEvent));
    this.element.addEventListener('click', (event) => this.onClick(event));
    document.addEventListener('selectionchange', () => this.readSelection());
  }

  private shiftSelection(edits: readonly TextEdit[]): void {
    if (edits.length === 0) return;
    const start = shiftPosThrough(this.selection.at, edits, false);
    const end = shiftPosThrough(this.selection.at + this.selection.length, edits, false);
    this.selection = { at: start, length: Math.max(0, end - start) };
    this.focusAt = shiftPosThrough(this.focusAt, edits, false);
  }

  setDecorations(next: Partial<PageDecorations>): void {
    this.decorations = { ...this.decorations, ...next };
  }

  get decorationState(): PageDecorations {
    return this.decorations;
  }

  private onClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    const chip = target?.closest('[data-marker-for]');
    if (chip) {
      event.preventDefault();
      this.hooks.onMarkerActivate(chip.getAttribute('data-marker-for') as string);
      return;
    }
    const anchored = target?.closest('[data-anchor-for]');
    if (anchored) this.hooks.onCardTarget(anchored.getAttribute('data-anchor-for') as string);
  }

  readSelection(): void {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    // A click on a toolbar control collapses the page selection; the last one still stands.
    if (document.activeElement !== null && !this.element.contains(document.activeElement)) return;
    const range = selection.getRangeAt(0);
    if (!this.element.contains(range.startContainer)) return;
    const start = this.offsetOf(range.startContainer, range.startOffset);
    const end = this.offsetOf(range.endContainer, range.endOffset);
    const focus = selection.focusNode ? this.offsetOf(selection.focusNode, selection.focusOffset) : end;
    this.selection = { at: Math.min(start, end), length: Math.abs(end - start) };
    this.focusAt = focus;
    this.hooks.onSelectionChange(this.selection, this.focusAt);
  }

  private textLengthOf(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').length;
    const element = node as HTMLElement;
    if (element.hasAttribute?.('data-marker-for')) return 0;
    if (element.tagName === 'BR') return 0;
    return element.textContent?.length ?? 0;
  }

  offsetOf(node: Node, offset: number): number {
    if (node.nodeType === Node.TEXT_NODE) {
      const run = (node.parentElement as HTMLElement | null)?.closest('[data-at]');
      if (run) return Number(run.getAttribute('data-at')) + offset;
      const block = (node.parentElement as HTMLElement | null)?.closest('[data-block-at]');
      return block ? Number(block.getAttribute('data-block-at')) : 0;
    }
    const element = node as HTMLElement;
    if (element.hasAttribute('data-at')) {
      const at = Number(element.getAttribute('data-at'));
      return offset === 0 ? at : at + (element.textContent?.length ?? 0);
    }
    if (element.hasAttribute('data-block-at')) {
      let sum = Number(element.getAttribute('data-block-at'));
      for (let index = 0; index < offset && index < element.childNodes.length; index += 1) {
        sum += this.textLengthOf(element.childNodes[index] as Node);
      }
      return sum;
    }
    if (element === this.element) {
      const blocks = blocksOf(this.session.state);
      const block = blocks[Math.min(offset, blocks.length - 1)];
      return block ? block.at : 0;
    }
    const block = element.closest('[data-block-at]');
    return block ? Number(block.getAttribute('data-block-at')) : 0;
  }

  pointOf(offset: number): { node: Node; offset: number } {
    const runs = [...this.element.querySelectorAll<HTMLElement>('[data-at]')];
    let fallback: { node: Node; offset: number } | null = null;
    for (const run of runs) {
      const at = Number(run.getAttribute('data-at'));
      const length = run.textContent?.length ?? 0;
      if (offset < at || offset > at + length) continue;
      const text = this.firstTextNode(run);
      if (!text) continue;
      const point = { node: text, offset: offset - at };
      if (offset < at + length) return point;
      fallback = point;
    }
    if (fallback) return fallback;
    const blocks = blocksOf(this.session.state);
    const index = blocks.findIndex((block) => offset >= block.at && offset <= block.at + block.length);
    const blockElement = this.element.children[Math.max(0, index)] as HTMLElement | undefined;
    return { node: blockElement ?? this.element, offset: 0 };
  }

  private firstTextNode(node: Node): Text | null {
    if (node.nodeType === Node.TEXT_NODE) return node as Text;
    for (const child of [...node.childNodes]) {
      const found = this.firstTextNode(child);
      if (found) return found;
    }
    return null;
  }

  setSelection(span: Span, focusAtEnd = true): void {
    this.selection = span;
    this.focusAt = focusAtEnd ? span.at + span.length : span.at;
    const start = this.pointOf(span.at);
    const end = this.pointOf(span.at + span.length);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    this.hooks.onSelectionChange(this.selection, this.focusAt);
  }

  focusPage(): void {
    this.element.focus();
  }

  marksAt(span: Span): Set<MarkType> {
    const marks = new Set<MarkType>(['bold', 'italic', 'underline', 'link']);
    const from = span.length > 0 ? span.at : Math.max(0, span.at - 1);
    const to = span.length > 0 ? span.at + span.length : span.at;
    if (to <= from) return new Set();
    for (const type of [...marks]) {
      for (let index = from; index < to; index += 1) {
        const covered = this.session.state.marks.some(
          (mark) => mark.type === type && index >= mark.at && index < mark.at + mark.length,
        );
        if (!covered) {
          marks.delete(type);
          break;
        }
      }
    }
    return marks;
  }

  blockStyleAt(offset: number): Block['style'] {
    const blocks = blocksOf(this.session.state);
    const block = blocks.find((candidate) => offset >= candidate.at && offset <= candidate.at + candidate.length);
    return block?.style ?? 'paragraph';
  }

  private runsOf(block: Block): RunSpec[] {
    const state = this.session.state;
    const end = block.at + block.length;
    const boundaries = new Set<number>([block.at, end]);
    const add = (at: number, length: number): void => {
      const from = Math.max(block.at, at);
      const to = Math.min(end, at + length);
      if (to > from) {
        boundaries.add(from);
        boundaries.add(to);
      }
    };
    for (const mark of state.marks) add(mark.at, mark.length);
    for (const suggestion of state.suggestions) {
      if (suggestion.inserted) add(suggestion.inserted.at, suggestion.inserted.length);
      if (suggestion.deleted) add(suggestion.deleted.at, suggestion.deleted.length);
    }
    for (const comment of state.comments) {
      if (comment.anchor && !this.decorations.hiddenCommentIds.has(comment.id)) {
        add(comment.anchor.at, comment.anchor.length);
      }
    }
    for (const match of this.decorations.matches) add(match.at, match.length);
    for (const fade of this.decorations.inkFade) add(fade.at, fade.length);
    const sorted = [...boundaries].sort((a, b) => a - b);
    const runs: RunSpec[] = [];
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const at = sorted[index] as number;
      const length = (sorted[index + 1] as number) - at;
      if (length <= 0) continue;
      const covers = (span: Span): boolean => at >= span.at && at + length <= span.at + span.length;
      const insertion = state.suggestions.find((suggestion) => suggestion.inserted && covers(suggestion.inserted));
      const deletion = state.suggestions.find((suggestion) => suggestion.deleted && covers(suggestion.deleted));
      const anchors: string[] = [];
      if (insertion) anchors.push(insertion.id);
      if (deletion && deletion.id !== insertion?.id) anchors.push(deletion.id);
      for (const comment of state.comments) {
        if (comment.anchor && covers(comment.anchor) && !this.decorations.hiddenCommentIds.has(comment.id)) {
          anchors.push(comment.id);
        }
      }
      const commentHere = state.comments.find(
        (comment) => comment.anchor && covers(comment.anchor) && !this.decorations.hiddenCommentIds.has(comment.id),
      );
      const colour = insertion
        ? this.session.personColour(insertion.author.personId)
        : deletion
          ? this.session.personColour(deletion.author.personId)
          : commentHere
            ? this.session.personColour(commentHere.author.personId)
            : null;
      const matchIndex = this.decorations.matches.findIndex((match) => covers(match));
      runs.push({
        colour,
        at,
        length,
        marks: state.marks
          .filter((mark) => covers({ at: mark.at, length: mark.length }))
          .map((mark) => (mark.href === undefined ? { type: mark.type } : { type: mark.type, href: mark.href })),
        insertionOf: insertion ? { id: insertion.id, colour: this.session.personColour(insertion.author.personId) } : null,
        deletionOf: deletion ? { id: deletion.id, colour: this.session.personColour(deletion.author.personId) } : null,
        anchors,
        match: matchIndex === -1 ? 'none' : matchIndex === this.decorations.currentMatch ? 'current' : 'match',
      });
    }
    return runs;
  }

  private renderRun(run: RunSpec, text: string): HTMLElement {
    const classes = ['run'];
    if (run.insertionOf) classes.push('suggest-insert');
    if (run.deletionOf) classes.push('suggest-delete');
    if (run.anchors.length > 0) classes.push('anchored');
    if (this.decorations.focusedCardId !== null && run.anchors.includes(this.decorations.focusedCardId)) classes.push('deep');
    if (run.match !== 'none') classes.push(run.match === 'current' ? 'match-current' : 'match');
    if (this.decorations.inkFade.some((span) => run.at >= span.at && run.at + run.length <= span.at + span.length)) {
      classes.push('ink-fade');
    }
    const colour = run.colour;
    const outer = el('span', {
      class: classes.join(' '),
      'data-at': run.at,
      style: colour ? `--author-colour:${colour}` : null,
    });
    if (run.anchors[0]) outer.setAttribute('data-anchor-for', run.anchors[0]);
    let host: HTMLElement = outer;
    for (const id of run.anchors.slice(1)) {
      const nested = el('span', { 'data-anchor-for': id, class: 'anchored' });
      host.appendChild(nested);
      host = nested;
    }
    for (const mark of run.marks) {
      const node =
        mark.type === 'bold'
          ? el('strong')
          : mark.type === 'italic'
            ? el('em')
            : mark.type === 'underline'
              ? el('u')
              : el('a', { class: 'link', href: mark.href ?? '#', rel: 'noreferrer' });
      host.appendChild(node);
      host = node;
    }
    host.appendChild(document.createTextNode(text));
    return outer;
  }

  render(): void {
    const hadFocus = this.element.contains(document.activeElement);
    const state = this.session.state;
    clear(this.element);
    const blocks = blocksOf(state);
    const chipTargets = new Map<number, string[]>();
    if (this.decorations.markers.size > 0) {
      for (const [id] of this.decorations.markers) {
        const suggestion = state.suggestions.find((candidate) => candidate.id === id);
        const comment = state.comments.find((candidate) => candidate.id === id);
        const span = suggestion ? suggestion.inserted ?? suggestion.deleted : comment?.anchor ?? null;
        if (!span) continue;
        const endAt = span.at + span.length;
        const list = chipTargets.get(endAt) ?? [];
        list.push(id);
        chipTargets.set(endAt, list);
      }
    }
    for (const block of blocks) {
      const element = el(BLOCK_TAGS[block.style], {
        class: `block ${block.style}`,
        'data-block-at': block.at,
      });
      const runs = this.runsOf(block);
      if (runs.length === 0) {
        element.appendChild(el('br'));
      }
      for (const run of runs) {
        element.appendChild(this.renderRun(run, state.text.slice(run.at, run.at + run.length)));
        const chips = chipTargets.get(run.at + run.length);
        for (const id of chips ?? []) {
          const number = this.decorations.markers.get(id) ?? 0;
          element.appendChild(
            el('button', {
              type: 'button',
              class: 'marker-chip',
              contenteditable: 'false',
              'data-marker-for': id,
              'aria-label': `Card ${number}`,
              text: String(number),
            }),
          );
        }
      }
      this.element.appendChild(element);
    }
    this.element.setAttribute('aria-readonly', this.session.mode === 'viewing' ? 'true' : 'false');
    if (hadFocus) {
      const clamped = Math.min(this.selection.at, state.text.length);
      const length = Math.min(this.selection.length, state.text.length - clamped);
      this.setSelection({ at: clamped, length });
    }
    this.renderCarets();
  }

  renderCarets(): void {
    clear(this.caretLayer);
    const host = this.caretLayer.getBoundingClientRect();
    for (const caret of this.session.carets.values()) {
      if (caret.person.personId === this.session.me.personId) continue;
      const at = Math.min(caret.at, this.session.state.text.length);
      const point = this.pointOf(at);
      const range = document.createRange();
      try {
        range.setStart(point.node, point.offset);
        range.setEnd(point.node, point.offset);
      } catch {
        continue;
      }
      const rect = range.getBoundingClientRect();
      const marker = el('span', {
        class: 'remote-caret',
        'data-caret-for': caret.person.personId,
        style: `left:${rect.left - host.left}px; top:${rect.top - host.top}px; height:${Math.max(rect.height, 18)}px; --author-colour:${caret.person.colour}`,
      });
      if (caret.state === 'active') {
        marker.appendChild(el('span', { class: 'caret-label', text: caret.person.displayName }));
      }
      this.caretLayer.appendChild(marker);
    }
  }

  private onBeforeInput(event: InputEvent): void {
    event.preventDefault();
    if (!this.session.editable || !this.session.canEdit && this.session.mode === 'editing') return;
    this.readSelection();
    const type = event.inputType;
    if (type === 'insertText' || type === 'insertCompositionText' || type === 'insertReplacementText') {
      if (event.data) this.insertText(event.data);
      return;
    }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      this.insertText('\n');
      return;
    }
    if (type === 'deleteContentBackward' || type === 'deleteByCut' || type === 'deleteContentForward' || type === 'deleteWordBackward' || type === 'deleteWordForward') {
      this.deleteFor(type);
      return;
    }
    if (type === 'insertFromPaste' || type === 'insertFromDrop') return;
  }

  private onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    if (!this.session.editable) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const plain = text.replace(/\r\n?/gu, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/gu, '');
    if (plain.length > 0) this.insertText(plain);
  }

  private onCut(event: ClipboardEvent): void {
    if (!this.session.editable || this.selection.length === 0) {
      event.preventDefault();
      return;
    }
    event.clipboardData?.setData('text/plain', this.session.state.text.slice(this.selection.at, this.selection.at + this.selection.length));
    event.preventDefault();
    this.deleteSpan(this.selection.at, this.selection.length);
  }

  insertText(text: string): void {
    const mode = this.session.editMode;
    const selection = this.selection;
    const entries: OpEntry[] = [];
    let caret: number;
    if (selection.length > 0) {
      entries.push({ delete: selection.length, at: selection.at });
      const at = mode === 'suggesting' ? selection.at + selection.length : selection.at;
      entries.push({ insert: text, at });
      caret = at + text.length;
    } else {
      entries.push({ insert: text, at: selection.at });
      caret = selection.at + text.length;
    }
    this.session.applyLocal(entries, mode);
    this.setSelection({ at: caret, length: 0 });
  }

  deleteSpan(at: number, length: number): void {
    if (length <= 0) return;
    this.session.applyLocal([{ delete: length, at }], this.session.editMode);
    this.setSelection({ at, length: 0 });
  }

  private deleteFor(type: string): void {
    const selection = this.selection;
    const text = this.session.state.text;
    if (selection.length > 0) {
      this.deleteSpan(selection.at, selection.length);
      return;
    }
    if (type === 'deleteContentForward') {
      if (selection.at < text.length) this.deleteSpan(selection.at, 1);
      return;
    }
    if (type === 'deleteWordBackward') {
      const start = wordStartBefore(text, selection.at);
      this.deleteSpan(start, selection.at - start);
      return;
    }
    if (type === 'deleteWordForward') {
      const end = wordEndAfter(text, selection.at);
      this.deleteSpan(selection.at, end - selection.at);
      return;
    }
    if (selection.at > 0) this.deleteSpan(selection.at - 1, 1);
  }

  toggleMark(type: Exclude<MarkType, 'link'>): void {
    if (!this.session.canEdit || this.session.mode !== 'editing') return;
    const selection = this.selection;
    if (selection.length === 0) return;
    const active = this.marksAt(selection).has(type);
    this.session.applyLocal([{ mark: type, value: !active, at: selection.at, length: selection.length }], 'editing');
  }

  setLink(href: string | null): void {
    if (!this.session.canEdit || this.session.mode !== 'editing') return;
    const selection = this.selection;
    if (selection.length === 0) return;
    this.session.applyLocal([{ mark: 'link', value: href, at: selection.at, length: selection.length }], 'editing');
  }

  setBlockStyle(style: Block['style']): void {
    if (!this.session.canEdit || this.session.mode !== 'editing') return;
    this.session.applyLocal([{ style, at: this.selection.at }], 'editing');
  }

  appendTo(parent: HTMLElement): void {
    append(parent, [this.element, this.caretLayer]);
  }
}
