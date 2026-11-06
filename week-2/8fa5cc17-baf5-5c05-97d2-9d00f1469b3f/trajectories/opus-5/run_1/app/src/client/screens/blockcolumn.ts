import { api } from '../api';
import { el, prefersReducedMotion } from '../dom';
import { frame } from '../frame';
import { BlockDto, BlockSearchResultDto } from '../types';
import { editTextOf } from '../../shared/richtext';
import {
  Op,
  applyOpsToText,
  diffToOps,
  hasOpConflict,
  transformOffset,
  transformOverCommitted,
} from '../../shared/ops';
import { MarginTether, QuoteChipTarget } from '../components/tether';
import { openQuotePicker } from '../components/quotepicker';
import { openBlockHistory } from '../components/history';
import { RemoteCarets, PresenceState } from '../components/caret';
import { UndoStack, Outcome } from '../components/undo';
import { animate } from '../anim';
import { ARRIVAL_MARK_MS, BLOCK_GAP_MS, MORPH_CANCEL_MS, MORPH_MS, PRESENCE_REPORT_MS, SAVE_DEBOUNCE_MS } from '../../shared/motion';
import {
  COPY,
  blockQuotedElsewhereCopy,
  quoteRemovedCopy,
  quotedCopy,
} from '../../shared/copy';

export type BlockColumnHost = {
  objectId: () => string;
  isPhone: () => boolean;
  tether: () => MarginTether | null;
  undo: () => UndoStack;
  afterChange: () => void;
  createBlock: (afterBlockId: string | null, body: string) => Promise<BlockDto | null>;
};

type View = {
  block: BlockDto;
  wrapper: HTMLElement;
  textarea: HTMLTextAreaElement | null;
  baseVersion: number;
  confirmedText: string;
  inFlight: { ops: Op[]; editId: string; base: number; before: string; after: string } | null;
  saveTimer: number;
  suppressSave: boolean;
  conflict: HTMLElement | null;
  presences: PresenceState[];
  carets: RemoteCarets;
  presenceSent: number;
};

function editIdOf(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** The text column: blocks, their ops saves, their quotes and their carets. */
export class BlockColumn {
  readonly node: HTMLElement;
  private views: View[] = [];
  private readonly ownEditIds = new Set<string>();

  constructor(private readonly host: BlockColumnHost) {
    this.node = el('div', { className: 'blocks' });
  }

  blocks(): BlockDto[] {
    return this.views.map((view) => view.block);
  }

  setBlocks(blocks: BlockDto[]): void {
    const active = document.activeElement;
    const caret =
      active instanceof HTMLTextAreaElement
        ? { node: active, start: active.selectionStart, end: active.selectionEnd }
        : null;
    const kept = new Map(this.views.map((view) => [view.block.id, view]));
    const next: View[] = [];
    for (const block of blocks) {
      const existing = kept.get(block.id);
      if (existing !== undefined) {
        existing.block = block;
        kept.delete(block.id);
        next.push(existing);
        continue;
      }
      next.push(this.buildView(block));
    }
    for (const stale of kept.values()) stale.wrapper.remove();
    this.views = next;
    // Blocks are moved only when their place changed, so a focused block keeps its caret.
    this.views.forEach((view, index) => {
      if (this.node.children[index] === view.wrapper) return;
      this.node.insertBefore(view.wrapper, this.node.children[index] ?? null);
    });
    this.renumber();
    if (caret !== null && document.contains(caret.node) && document.activeElement !== caret.node) {
      caret.node.focus();
      caret.node.setSelectionRange(caret.start, caret.end);
    }
    this.host.afterChange();
  }

  private renumber(): void {
    this.views.forEach((view, index) => {
      const position = index + 1;
      view.block.position = position;
      if (view.textarea !== null) view.textarea.setAttribute('aria-label', `Block ${position}`);
      const history = view.wrapper.querySelector<HTMLButtonElement>('.block-history');
      if (history !== null) history.setAttribute('aria-label', `History of block ${position}`);
    });
  }

  private buildView(block: BlockDto): View {
    const wrapper = el('div', { className: `block block-${block.kind}` });
    const view: View = {
      block,
      wrapper,
      textarea: null,
      baseVersion: block.version,
      confirmedText: editTextOf(block.body ?? ''),
      inFlight: null,
      saveTimer: 0,
      suppressSave: false,
      conflict: null,
      presences: [],
      carets: new RemoteCarets(wrapper),
      presenceSent: 0,
    };
    if (block.kind === 'attachment') {
      wrapper.append(this.attachmentFigure(block));
      return view;
    }
    const textarea = el('textarea', {
      className: 'block-text',
      attrs: { 'aria-label': `Block ${block.position}`, rows: '1', spellcheck: 'false' },
    });
    textarea.value = view.confirmedText;
    view.textarea = textarea;
    this.wireEditing(view, textarea);
    const history = el('button', {
      className: 'block-history',
      text: 'History',
      attrs: { type: 'button', 'aria-label': `History of block ${block.position}` },
    });
    history.addEventListener('click', () => {
      openBlockHistory({
        blockId: block.id,
        opener: history,
        currentVersion: () => view.baseVersion,
        onRestored: (restored) => {
          view.baseVersion = restored.version;
          view.confirmedText = editTextOf(restored.body ?? '');
          if (view.textarea !== null) view.textarea.value = view.confirmedText;
          this.autosize(view);
        },
      });
    });
    if (block.kind === 'quote') {
      const figure = el('figure', {
        className: 'quote-figure',
        attrs: { 'aria-label': `Quote from ${block.origin?.object_title ?? ''}` },
      });
      figure.append(textarea, history, this.removeQuoteButton(view));
      if (this.host.isPhone() && block.origin !== null) {
        figure.prepend(this.inlineChip(block));
      }
      wrapper.append(figure);
    } else {
      wrapper.append(textarea, history);
    }
    this.autosize(view);
    return view;
  }

  private inlineChip(block: BlockDto): HTMLElement {
    const origin = block.origin;
    const chip = el('a', {
      className: 'origin-chip inline-chip',
      attrs: {
        href: `/o/${origin?.object_id ?? ''}`,
        'aria-label': `Quoted from ${origin?.object_title ?? ''}, ${origin === null ? '0 backlinks' : `${origin.backlinks} ${origin.backlinks === 1 ? 'backlink' : 'backlinks'}`}`,
      },
    });
    chip.append(
      el('span', { className: 'chip-title', text: origin?.object_title ?? '' }),
      el('span', {
        className: 'chip-count',
        text: String(origin?.backlinks ?? 0),
        attrs: { 'data-backlink-count': String(origin?.backlinks ?? 0) },
      }),
    );
    return chip;
  }

  private attachmentFigure(block: BlockDto): HTMLElement {
    const attachment = block.attachment;
    const filename = attachment?.filename ?? '';
    const figure = el('figure', { className: 'attachment-figure', attrs: { 'aria-label': filename } });
    if (attachment === null) return figure;
    if (frame().storageOutage()) {
      figure.append(el('p', { className: 'attachment-outage', text: COPY.attachmentDuringOutage }));
      return figure;
    }
    if (attachment.content_type.startsWith('image/')) {
      figure.append(
        el('img', { attrs: { src: `/api/attachments/${attachment.id}`, alt: filename, loading: 'lazy' } }),
      );
    } else {
      figure.append(el('a', { text: filename, attrs: { href: `/api/attachments/${attachment.id}` } }));
    }
    figure.append(el('figcaption', { text: filename }));
    return figure;
  }

  private removeQuoteButton(view: View): HTMLButtonElement {
    const button = el('button', {
      className: 'remove-quote',
      text: 'Remove quote',
      attrs: { type: 'button', 'aria-label': 'Remove quote' },
    });
    button.addEventListener('click', () => void this.removeQuote(view));
    return button;
  }

  private autosize(view: View): void {
    const textarea = view.textarea;
    if (textarea === null) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  viewOf(blockId: string): View | undefined {
    return this.views.find((view) => view.block.id === blockId);
  }

  focusBlock(blockId: string, offset?: number): void {
    const view = this.viewOf(blockId);
    if (view?.textarea == null) return;
    view.textarea.focus();
    if (offset !== undefined) view.textarea.setSelectionRange(offset, offset);
  }

  quoteTargets(): QuoteChipTarget[] {
    return this.views
      .filter((view) => view.block.kind === 'quote' && view.block.origin !== null)
      .map((view) => ({
        quoteBlockId: view.block.id,
        originObjectId: view.block.origin?.object_id ?? '',
        originTitle: view.block.origin?.object_title ?? '',
        backlinks: view.block.origin?.backlinks ?? 0,
        blockElement: view.wrapper,
      }));
  }

  updateOriginCounts(objectId: string, count: number): void {
    for (const view of this.views) {
      if (view.block.origin === null || view.block.origin.object_id !== objectId) continue;
      view.block.origin.backlinks = count;
      const chip = view.wrapper.querySelector<HTMLElement>('.inline-chip .chip-count');
      if (chip !== null) {
        chip.setAttribute('data-backlink-count', String(count));
        chip.textContent = String(count);
      }
    }
  }

  /* ------------------------------------------------------------ editing */

  private wireEditing(view: View, textarea: HTMLTextAreaElement): void {
    textarea.addEventListener('input', () => {
      this.autosize(view);
      if (this.openedPicker(view)) return;
      this.scheduleSave(view);
    });
    textarea.addEventListener('blur', () => {
      if (view.saveTimer !== 0) window.clearTimeout(view.saveTimer);
      view.saveTimer = 0;
      void this.save(view);
      void api.del(`/api/blocks/${view.block.id}/presence`);
    });
    textarea.addEventListener('keyup', () => this.reportPresence(view));
    textarea.addEventListener('click', () => this.reportPresence(view));
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.enterAtEnd(view);
        return;
      }
      if (event.key === 'Backspace' && textarea.value === '' && view.block.kind === 'text') {
        event.preventDefault();
        void this.deleteBlock(view);
      }
    });
  }

  private openedPicker(view: View): boolean {
    const textarea = view.textarea;
    if (textarea === null) return false;
    const caret = textarea.selectionStart;
    if (caret < 2 || textarea.value.slice(caret - 2, caret) !== '((') return false;
    view.suppressSave = true;
    if (view.saveTimer !== 0) {
      window.clearTimeout(view.saveTimer);
      view.saveTimer = 0;
    }
    this.openPicker(view, caret);
    return true;
  }

  private scheduleSave(view: View): void {
    if (view.suppressSave) return;
    if (view.saveTimer !== 0) window.clearTimeout(view.saveTimer);
    view.saveTimer = window.setTimeout(() => {
      view.saveTimer = 0;
      void this.save(view);
    }, SAVE_DEBOUNCE_MS);
  }

  private async save(view: View): Promise<void> {
    const textarea = view.textarea;
    if (textarea === null || view.inFlight !== null || view.conflict !== null || view.suppressSave) return;
    const text = textarea.value;
    const ops = diffToOps(view.confirmedText, text);
    if (ops.length === 0) return;
    const editId = editIdOf();
    this.ownEditIds.add(editId);
    view.inFlight = { ops, editId, base: view.baseVersion, before: view.confirmedText, after: text };
    frame().setSaveStatus(COPY.savePending);
    const result = await api.patch<BlockDto>(`/api/blocks/${view.block.id}`, {
      ops,
      base_version: view.baseVersion,
      edit_id: editId,
    });
    const flight = view.inFlight;
    view.inFlight = null;
    if (result.ok) {
      this.confirmCommit(view, result.data, flight);
      frame().setSaveStatus(COPY.saveDone);
      if (view.textarea !== null && view.textarea.value !== view.confirmedText) this.scheduleSave(view);
      return;
    }
    if (result.status === 409) {
      const current = (result.data as { current?: BlockDto } | undefined)?.current;
      if (current !== undefined) this.openConflict(view, current);
      return;
    }
    if (result.status === 0) {
      frame().setSaveStatus(COPY.saveFailed);
      return;
    }
    if (result.errors !== undefined) frame().showAlert(Object.values(result.errors)[0] ?? '');
  }

  private confirmCommit(
    view: View,
    block: BlockDto,
    flight: { ops: Op[]; base: number; before: string; after: string } | null,
  ): void {
    view.baseVersion = block.version;
    view.confirmedText = editTextOf(block.body ?? '');
    view.block.version = block.version;
    view.block.body = block.body;
    if (flight !== null) {
      this.host.undo().pushTyping({
        blockId: view.block.id,
        beforeText: flight.before,
        afterText: flight.after,
        version: block.version,
        caretEnd: view.textarea?.selectionStart ?? flight.after.length,
        isDelete: flight.after.length < flight.before.length,
      });
    }
  }

  private reportPresence(view: View): void {
    const textarea = view.textarea;
    if (textarea === null) return;
    const now = performance.now();
    if (now - view.presenceSent < PRESENCE_REPORT_MS) return;
    view.presenceSent = now;
    void api.post(`/api/blocks/${view.block.id}/presence`, {
      anchor: Math.min(textarea.selectionStart, view.confirmedText.length),
      head: Math.min(textarea.selectionEnd, view.confirmedText.length),
      version: view.baseVersion,
    });
  }

  /* ------------------------------------------------------- the conflict */

  private openConflict(view: View, current: BlockDto): void {
    const theirText = editTextOf(current.body ?? '');
    const draft = view.textarea?.value ?? '';
    if (view.conflict !== null) {
      const theirs = view.conflict.querySelector('.conflict-theirs');
      if (theirs !== null) theirs.textContent = theirText;
      return;
    }
    const keepMine = el('button', { text: 'Keep mine', attrs: { type: 'button' } });
    const keepTheirs = el('button', { text: 'Keep theirs', attrs: { type: 'button' } });
    const panel = el('div', {
      className: 'edit-conflict',
      attrs: { role: 'region', 'aria-label': 'Edit conflict' },
      children: [
        el('p', { text: COPY.editConflict }),
        el('p', { className: 'conflict-theirs', text: theirText }),
        el('p', { className: 'conflict-mine', text: draft }),
        keepMine,
        keepTheirs,
      ],
    });
    view.conflict = panel;
    view.wrapper.prepend(panel);
    keepMine.addEventListener('click', () => {
      void this.resolveConflict(view, 'mine', current);
    });
    keepTheirs.addEventListener('click', () => {
      void this.resolveConflict(view, 'theirs', current);
    });
  }

  private async resolveConflict(view: View, choice: 'mine' | 'theirs', current: BlockDto): Promise<void> {
    const panel = view.conflict;
    const latestTheir = panel?.querySelector('.conflict-theirs')?.textContent ?? '';
    view.conflict = null;
    if (panel !== null) panel.remove();
    if (choice === 'theirs') {
      view.baseVersion = current.version;
      view.confirmedText = latestTheir;
      if (view.textarea !== null) {
        view.textarea.value = latestTheir;
        this.autosize(view);
        view.textarea.focus();
      }
      return;
    }
    const draft = view.textarea?.value ?? '';
    const result = await api.patch<BlockDto>(`/api/blocks/${view.block.id}`, {
      body: draft,
      base_version: current.version,
    });
    if (result.ok) {
      view.baseVersion = result.data.version;
      view.confirmedText = editTextOf(result.data.body ?? '');
      frame().setSaveStatus(COPY.saveDone);
    } else if (result.status === 409) {
      const next = (result.data as { current?: BlockDto } | undefined)?.current;
      if (next !== undefined) this.openConflict(view, next);
    }
    if (view.textarea !== null) view.textarea.focus();
  }

  /* -------------------------------------------------------- new blocks */

  private async enterAtEnd(view: View): Promise<void> {
    const created = await this.host.createBlock(view.block.id, '');
    if (created === null) return;
    this.focusBlock(created.id, 0);
    this.host.undo().push({
      kind: 'new block',
      undo: async () => {
        const result = await api.del(`/api/blocks/${created.id}`);
        return result.ok ? { ok: true } : { ok: false, reason: 'conflict' };
      },
      redo: async () => {
        const again = await this.host.createBlock(view.block.id, created.body ?? '');
        return again === null ? { ok: false, reason: 'conflict' } : { ok: true };
      },
    });
  }

  private async deleteBlock(view: View): Promise<void> {
    const index = this.views.indexOf(view);
    const body = view.block.body ?? '';
    const previous = this.views[index - 1];
    const result = await api.del<null>(`/api/blocks/${view.block.id}`);
    if (!result.ok) {
      if (result.status === 409) {
        const quoted = (result.data as { quoted_in?: number } | undefined)?.quoted_in ?? 0;
        frame().showAlert(blockQuotedElsewhereCopy(quoted));
      }
      return;
    }
    this.removeView(view);
    if (previous?.textarea != null) {
      previous.textarea.focus();
      previous.textarea.setSelectionRange(previous.textarea.value.length, previous.textarea.value.length);
    }
    const afterId = previous === undefined ? null : previous.block.id;
    this.host.undo().push({
      kind: 'block deletion',
      undo: async () => {
        const again = await this.host.createBlock(afterId, body);
        return again === null ? { ok: false, reason: 'conflict' } : { ok: true };
      },
      redo: async () => ({ ok: true }),
    });
  }

  /** The blocks below slide up to close the gap. */
  private removeView(view: View): void {
    const index = this.views.indexOf(view);
    const below = this.views.slice(index + 1);
    const offsets = below.map((other) => other.wrapper.getBoundingClientRect().top);
    view.carets.clear();
    view.wrapper.remove();
    this.views = this.views.filter((other) => other !== view);
    this.renumber();
    if (!prefersReducedMotion()) {
      below.forEach((other, position) => {
        const now = other.wrapper.getBoundingClientRect().top;
        const delta = offsets[position] - now;
        if (Math.abs(delta) < 1) return;
        animate(other.wrapper, [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], BLOCK_GAP_MS);
      });
    }
    this.host.afterChange();
  }

  /* ------------------------------------------------------------ quoting */

  private openPicker(view: View, caretAfterParens: number): void {
    const textarea = view.textarea as HTMLTextAreaElement;
    openQuotePicker({
      excludeObjectId: this.host.objectId(),
      opener: textarea,
      onChoose: (result, row) => void this.quoteFrom(view, result, row, caretAfterParens),
      onCancel: () => {
        view.suppressSave = false;
        textarea.focus();
        textarea.setSelectionRange(caretAfterParens, caretAfterParens);
      },
    });
  }

  /** The morph, then the tether, then the numeral, only after the server confirms. */
  private async quoteFrom(
    view: View,
    result: BlockSearchResultDto,
    row: HTMLElement,
    caretAfterParens: number,
  ): Promise<void> {
    const textarea = view.textarea as HTMLTextAreaElement;
    const card = this.morphCard(row, view.wrapper);
    const key = `quote-${editIdOf()}`;
    let answer = await api.post<{ block: BlockDto; origin_backlinks: number }>(
      `/api/objects/${this.host.objectId()}/quotes`,
      { origin_block_id: result.block_id, after_block_id: view.block.id },
      { 'Idempotency-Key': key },
    );
    if (answer.status === 0) {
      answer = await api.post<{ block: BlockDto; origin_backlinks: number }>(
        `/api/objects/${this.host.objectId()}/quotes`,
        { origin_block_id: result.block_id, after_block_id: view.block.id },
        { 'Idempotency-Key': key },
      );
    }
    if (!answer.ok) {
      this.collapseCard(card);
      frame().showAlert(COPY.quoteRefused);
      view.suppressSave = false;
      textarea.focus();
      textarea.setSelectionRange(caretAfterParens, caretAfterParens);
      return;
    }
    card.remove();
    const before = textarea.value;
    textarea.value = before.slice(0, caretAfterParens - 2) + before.slice(caretAfterParens);
    view.suppressSave = false;
    this.autosize(view);
    this.scheduleSave(view);
    await this.insertQuote(answer.data.block, answer.data.origin_backlinks, view);
    this.host.undo().push({
      kind: 'quote',
      undo: async () => {
        const removal = await api.del<{ origin_backlinks: number }>(`/api/blocks/${answer.data.block.id}`);
        if (!removal.ok) return { ok: false, reason: removal.status === 404 ? 'gone' : 'conflict' };
        const quoteView = this.viewOf(answer.data.block.id);
        if (quoteView !== undefined) await this.playRemoval(quoteView, removal.data.origin_backlinks);
        return { ok: true };
      },
      redo: async () => {
        const again = await api.post<{ block: BlockDto; origin_backlinks: number }>(
          `/api/objects/${this.host.objectId()}/quotes`,
          { origin_block_id: result.block_id, after_block_id: view.block.id },
        );
        if (!again.ok) return { ok: false, reason: again.status === 422 ? 'gone' : 'conflict' };
        await this.insertQuote(again.data.block, again.data.origin_backlinks, view);
        return { ok: true };
      },
    });
  }

  private async insertQuote(block: BlockDto, originBacklinks: number, after: View): Promise<void> {
    if (block.origin !== null) block.origin.backlinks = originBacklinks;
    const quoteView = this.buildView(block);
    const index = this.views.indexOf(after);
    this.views.splice(index + 1, 0, quoteView);
    after.wrapper.after(quoteView.wrapper);
    this.renumber();
    this.host.afterChange();
    const tether = this.host.tether();
    if (tether !== null) {
      await tether.drawTether(block.id);
      await tether.rollNumeral(block.id, originBacklinks);
    }
    frame().announce(quotedCopy(block.origin?.object_title ?? '', originBacklinks));
    this.focusBlock(block.id);
  }

  private async removeQuote(view: View): Promise<void> {
    const index = this.views.indexOf(view);
    const result = await api.del<{ origin_object_id: string; origin_backlinks: number }>(
      `/api/blocks/${view.block.id}`,
    );
    if (!result.ok) {
      frame().showAlert(COPY.quoteRefused);
      return;
    }
    const originTitle = view.block.origin?.object_title ?? '';
    const originBlockId = view.block.origin?.block_id ?? '';
    const previous = this.views[index - 1];
    await this.playRemoval(view, result.data.origin_backlinks);
    frame().announce(quoteRemovedCopy(originTitle, result.data.origin_backlinks));
    if (previous?.textarea != null) previous.textarea.focus();
    else document.querySelector<HTMLButtonElement>('.add-block')?.focus();
    this.host.undo().push({
      kind: 'quote removal',
      undo: async () => {
        const again = await api.post<{ block: BlockDto; origin_backlinks: number }>(
          `/api/objects/${this.host.objectId()}/quotes`,
          { origin_block_id: originBlockId, after_block_id: previous?.block.id ?? null },
        );
        if (!again.ok) return { ok: false, reason: again.status === 422 ? 'gone' : 'conflict' };
        if (previous !== undefined) await this.insertQuote(again.data.block, again.data.origin_backlinks, previous);
        return { ok: true };
      },
      redo: async () => ({ ok: true }),
    });
  }

  /** The numeral rolls down, the tether pulls back, then the block collapses. */
  private async playRemoval(view: View, originBacklinks: number): Promise<void> {
    const tether = this.host.tether();
    if (tether !== null) {
      await tether.rollNumeral(view.block.id, originBacklinks);
      await tether.retractTether(view.block.id);
      tether.removeChip(view.block.id);
    }
    this.removeView(view);
  }

  private morphCard(row: HTMLElement, slotHost: HTMLElement): HTMLElement {
    const rect = row.getBoundingClientRect();
    const card = el('div', {
      className: 'morph-card',
      text: row.textContent ?? '',
      attrs: { 'aria-hidden': 'true' },
    });
    card.style.position = 'fixed';
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.width = `${rect.width}px`;
    card.style.height = `${rect.height}px`;
    document.body.append(card);
    const slot = slotHost.getBoundingClientRect();
    if (!prefersReducedMotion()) {
      animate(
        card,
        [
          { transform: 'translate(0, 0)', width: `${rect.width}px` },
          {
            transform: `translate(${slot.left - rect.left}px, ${slot.bottom - rect.top}px)`,
            width: `${slot.width}px`,
          },
        ],
        MORPH_MS,
      );
    }
    card.style.left = `${slot.left}px`;
    card.style.top = `${slot.bottom}px`;
    card.style.width = `${slot.width}px`;
    return card;
  }

  private collapseCard(card: HTMLElement): void {
    if (prefersReducedMotion()) {
      card.remove();
      return;
    }
    const animation = animate(card, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0)', opacity: 0 }], MORPH_CANCEL_MS);
    void animation.finished.then(
      () => card.remove(),
      () => card.remove(),
    );
  }

  /* --------------------------------------------------------- live edits */

  isOwnEdit(editId: string | null): boolean {
    return editId !== null && this.ownEditIds.has(editId);
  }

  applyBlockSaved(block: BlockDto, ops: Op[] | null, editId: string | null): void {
    const view = this.viewOf(block.id);
    if (view === undefined) return;
    const own = this.isOwnEdit(editId);
    if (own) {
      if (view.inFlight !== null && view.inFlight.editId === editId) {
        const flight = view.inFlight;
        view.inFlight = null;
        this.confirmCommit(view, block, flight);
      } else {
        view.baseVersion = Math.max(view.baseVersion, block.version);
      }
      return;
    }
    view.block.origin = block.origin;
    if (view.textarea === null) {
      view.block = block;
      return;
    }
    const textarea = view.textarea;
    const unsaved = diffToOps(view.confirmedText, textarea.value);
    const incomingText = editTextOf(block.body ?? '');
    this.markArrival(view);
    if (unsaved.length === 0) {
      const caret = textarea.selectionStart;
      textarea.value = incomingText;
      const moved = ops === null ? Math.min(caret, incomingText.length) : transformOffset(caret, ops, false);
      if (document.activeElement === textarea) textarea.setSelectionRange(moved, moved);
      view.confirmedText = incomingText;
      view.baseVersion = block.version;
      view.block = block;
      this.autosize(view);
      return;
    }
    if (ops === null || hasOpConflict(unsaved, ops)) return;
    const rebased = transformOverCommitted(unsaved, ops);
    const caret = textarea.selectionStart;
    textarea.value = applyOpsToText(incomingText, rebased);
    const moved = transformOffset(caret, ops, false);
    if (document.activeElement === textarea) textarea.setSelectionRange(moved, moved);
    view.confirmedText = incomingText;
    view.baseVersion = block.version;
    view.block = block;
    this.autosize(view);
  }

  private markArrival(view: View): void {
    const mark = el('span', { className: 'arrival-mark', attrs: { 'aria-hidden': 'true' } });
    view.wrapper.append(mark);
    if (prefersReducedMotion()) {
      window.setTimeout(() => mark.remove(), ARRIVAL_MARK_MS);
      return;
    }
    const animation = animate(mark, [{ opacity: 1 }, { opacity: 0 }], ARRIVAL_MARK_MS, 'linear');
    void animation.finished.then(
      () => mark.remove(),
      () => mark.remove(),
    );
  }

  applyBlockRemoved(blockId: string): void {
    const view = this.viewOf(blockId);
    if (view === undefined) return;
    const tether = this.host.tether();
    if (tether !== null) tether.removeChip(blockId);
    this.removeView(view);
  }

  applyPresence(blockId: string, sessionId: string, label: string, anchor: number | null, head: number | null): void {
    const view = this.views.find(
      (candidate) => candidate.block.id === blockId || candidate.block.origin?.block_id === blockId,
    );
    if (view?.textarea == null) return;
    view.presences = view.presences.filter((presence) => presence.sessionId !== sessionId);
    if (anchor !== null && head !== null) view.presences.push({ sessionId, label, anchor, head });
    view.carets.render(view.textarea, view.presences);
  }

  /** Text areas grow to their content, also once the reading face has loaded. */
  resizeAll(): void {
    for (const view of this.views) this.autosize(view);
  }

  repositionCarets(): void {
    for (const view of this.views) {
      if (view.textarea === null) continue;
      view.carets.render(view.textarea, view.presences);
    }
  }

  /** Undo and redo of typing go through the server. */
  async applyTyping(blockId: string, ops: Op[], baseVersion: number): Promise<Outcome> {
    const view = this.viewOf(blockId);
    const result = await api.patch<BlockDto>(`/api/blocks/${blockId}`, { ops, base_version: baseVersion });
    if (!result.ok) {
      return { ok: false, reason: result.status === 404 ? 'gone' : 'conflict' };
    }
    if (view !== undefined) {
      view.baseVersion = result.data.version;
      view.confirmedText = editTextOf(result.data.body ?? '');
      if (view.textarea !== null) {
        view.textarea.value = view.confirmedText;
        this.autosize(view);
      }
    }
    return { ok: true, version: result.data.version };
  }
}
