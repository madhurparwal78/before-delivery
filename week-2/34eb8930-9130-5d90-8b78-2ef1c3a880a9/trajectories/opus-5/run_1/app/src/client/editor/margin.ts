import { spanText } from '../../shared/doc.js';
import type { Comment, Person, Role, Span, Suggestion } from '../../shared/types.js';
import { ApiError, api } from '../api.js';
import { clear, el, svg } from '../dom.js';
import { announce } from '../shell.js';
import type { PageView } from './page.js';
import type { EditorSession } from './session.js';

const roleLabel = (role?: Role): string => (role ? role.charAt(0).toUpperCase() + role.slice(1) : '');

interface CardEntry {
  id: string;
  at: number;
  element: HTMLElement;
  colour: string;
  lastTop: number;
}

function suggestionText(session: EditorSession, suggestion: Suggestion): string {
  if (suggestion.contentDeleted) return 'Original content deleted';
  const inserted = spanText(session.state, suggestion.inserted);
  const deleted = spanText(session.state, suggestion.deleted);
  if (suggestion.kind === 'insert') return `Insert “${inserted}”`;
  if (suggestion.kind === 'delete') return `Delete “${deleted}”`;
  return `Replace “${deleted}” with “${inserted}”`;
}

function authorChip(session: EditorSession, person: Person): HTMLElement {
  return el('p', { class: 'card-meta' }, [
    el('span', { class: 'chip', style: `background:${session.personColour(person.personId)}` }),
    el('span', { class: 'card-author', text: person.displayName }),
    el('span', { class: 'card-role', text: roleLabel(person.role) }),
  ]);
}

/** The margin: suggestion and comment cards, their tethers and the phone sheet. */
export class MarginView {
  readonly column: HTMLElement;
  readonly tetherLayer: SVGElement;
  readonly sheetHost: HTMLElement;
  showResolved = false;
  focusedCardId: string | null = null;
  private entries: CardEntry[] = [];
  private readonly positions = new Map<string, number>();
  private draft: { span: Span; element: HTMLElement } | null = null;
  private ghosts: HTMLElement[] = [];

  constructor(
    private readonly session: EditorSession,
    private readonly page: PageView,
    private readonly onLayoutChange: () => void,
  ) {
    this.column = el('div', { class: 'margin-column', role: 'complementary', 'aria-label': 'Margin' });
    this.tetherLayer = svg('svg', { class: 'tether-layer', 'aria-hidden': 'true' });
    this.sheetHost = el('div', { class: 'sheet-host' });
  }

  get isPhone(): boolean {
    return window.matchMedia('(max-width: 767px)').matches;
  }

  private visibleComments(): Comment[] {
    return this.session.state.comments.filter((comment) => this.showResolved || comment.status !== 'resolved');
  }

  hiddenCommentIds(): Set<string> {
    return new Set(
      this.session.state.comments.filter((comment) => !this.showResolved && comment.status === 'resolved').map((c) => c.id),
    );
  }

  private orderedCards(): { id: string; at: number; render: () => HTMLElement; colour: string }[] {
    const cards: { id: string; at: number; render: () => HTMLElement; colour: string }[] = [];
    for (const suggestion of this.session.state.suggestions) {
      const span = suggestion.inserted ?? suggestion.deleted;
      const at = span ? span.at : (this.positions.get(suggestion.id) ?? this.session.state.text.length);
      this.positions.set(suggestion.id, at);
      cards.push({
        id: suggestion.id,
        at,
        colour: this.session.personColour(suggestion.author.personId),
        render: () => this.suggestionCard(suggestion),
      });
    }
    for (const comment of this.visibleComments()) {
      const at = comment.anchor ? comment.anchor.at : (this.positions.get(comment.id) ?? this.session.state.text.length);
      this.positions.set(comment.id, at);
      cards.push({
        id: comment.id,
        at,
        colour: this.session.personColour(comment.author.personId),
        render: () => this.commentCard(comment),
      });
    }
    cards.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    return cards;
  }

  markers(): Map<string, number> {
    if (!this.isPhone) return new Map();
    const markers = new Map<string, number>();
    let number = 0;
    for (const card of this.orderedCards()) {
      number += 1;
      markers.set(card.id, number);
    }
    return markers;
  }

  openCardCount(): number {
    return this.orderedCards().length;
  }

  private decide(suggestion: Suggestion, decision: 'accept' | 'reject', button: HTMLButtonElement): void {
    button.disabled = true;
    void this.session
      .decide(suggestion.id, decision)
      .then((applied) => {
        if (applied) announce(decision === 'accept' ? 'Suggestion accepted' : 'Suggestion rejected');
      })
      .catch(() => undefined);
  }

  private suggestionCard(suggestion: Suggestion): HTMLElement {
    const card = el('article', {
      class: 'card suggestion',
      'data-card-id': suggestion.id,
      tabindex: '0',
      'aria-label': `Suggestion by ${suggestion.author.displayName}`,
      style: `--author-colour:${this.session.personColour(suggestion.author.personId)}`,
    });
    card.appendChild(authorChip(this.session, suggestion.author));
    card.appendChild(el('p', { class: 'card-text', text: suggestionText(this.session, suggestion) }));
    if (this.session.canEdit) {
      const accept = el('button', { type: 'button', class: 'card-button', text: 'Accept' });
      const reject = el('button', { type: 'button', class: 'card-button', text: 'Reject' });
      accept.addEventListener('click', () => this.decide(suggestion, 'accept', accept));
      reject.addEventListener('click', () => this.decide(suggestion, 'reject', reject));
      card.appendChild(el('div', { class: 'card-actions' }, [accept, reject]));
      card.addEventListener('keydown', (event) => {
        const key = event as KeyboardEvent;
        if (key.key === 'Enter' && document.activeElement === card) {
          key.preventDefault();
          this.decide(suggestion, 'accept', accept);
        }
      });
    }
    this.wireCard(card, suggestion.id);
    return card;
  }

  private commentCard(comment: Comment): HTMLElement {
    const card = el('article', {
      class: `card comment status-${comment.status}`,
      'data-card-id': comment.id,
      tabindex: '0',
      'aria-label': `Comment by ${comment.author.displayName}`,
      style: `--author-colour:${this.session.personColour(comment.author.personId)}`,
    });
    card.appendChild(authorChip(this.session, comment.author));
    card.appendChild(
      el('p', {
        class: 'card-anchor',
        text: comment.contentDeleted ? 'Original content deleted' : `“${spanText(this.session.state, comment.anchor)}”`,
      }),
    );
    card.appendChild(el('p', { class: 'card-text', text: comment.body }));
    for (const reply of comment.replies) {
      card.appendChild(
        el('div', { class: 'card-reply' }, [
          authorChip(this.session, reply.author),
          el('p', { class: 'card-text', text: reply.body }),
        ]),
      );
    }
    if (this.session.canComment) {
      const replyBox = el('textarea', { class: 'reply-box', 'aria-label': 'Reply', rows: '2' });
      const replyButton = el('button', { type: 'button', class: 'card-button', text: 'Reply' });
      replyButton.addEventListener('click', () => {
        const body = replyBox.value.trim();
        if (body.length === 0) return;
        replyButton.disabled = true;
        replyButton.textContent = 'Posting';
        void api
          .comment(this.session.documentId, { body, mentions: [], parentId: comment.id })
          .then(() => {
            announce('Reply posted');
            replyBox.value = '';
          })
          .catch(() => undefined)
          .finally(() => {
            replyButton.disabled = false;
            replyButton.textContent = 'Reply';
          });
      });
      const resolved = comment.status === 'resolved';
      const toggle = el('button', { type: 'button', class: 'card-button', text: resolved ? 'Reopen' : 'Resolve' });
      toggle.addEventListener('click', () => {
        toggle.disabled = true;
        const action = resolved
          ? api.reopenComment(this.session.documentId, comment.id)
          : api.resolveComment(this.session.documentId, comment.id);
        void action
          .then(() => announce(resolved ? 'Comment reopened' : 'Comment resolved'))
          .catch(() => undefined)
          .finally(() => {
            toggle.disabled = false;
            this.render();
          });
      });
      card.appendChild(el('div', { class: 'card-actions' }, [replyBox, replyButton, toggle]));
    }
    this.wireCard(card, comment.id);
    return card;
  }

  private wireCard(card: HTMLElement, id: string): void {
    card.addEventListener('focusin', () => {
      this.focusedCardId = id;
      this.highlightFocus();
    });
    card.addEventListener('click', () => {
      this.focusedCardId = id;
      this.highlightFocus();
    });
    card.addEventListener('keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'Escape') {
        key.preventDefault();
        const at = this.positions.get(id) ?? 0;
        this.page.focusPage();
        this.page.setSelection({ at, length: 0 });
      }
    });
  }

  private highlightFocus(): void {
    for (const entry of this.entries) {
      entry.element.classList.toggle('focused', entry.id === this.focusedCardId);
    }
    this.layout();
    const id = this.focusedCardId;
    if (id) {
      const anchored = this.page.element.querySelector(`[data-anchor-for="${CSS.escape(id)}"]`);
      anchored?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }

  cardIds(): string[] {
    return this.entries.map((entry) => entry.id);
  }

  focusCard(id: string): void {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    this.focusedCardId = id;
    entry.element.focus();
    this.highlightFocus();
  }

  cycle(direction: 1 | -1): void {
    const ids = this.cardIds();
    if (ids.length === 0) return;
    const current = this.focusedCardId === null ? -1 : ids.indexOf(this.focusedCardId);
    if (current === -1) {
      const caret = this.page.selection.at;
      if (direction === 1) {
        const next = this.entries.find((entry) => entry.at >= caret) ?? this.entries[0];
        if (next) this.focusCard(next.id);
        return;
      }
      const previous = [...this.entries].reverse().find((entry) => entry.at < caret) ?? this.entries[this.entries.length - 1];
      if (previous) this.focusCard(previous.id);
      return;
    }
    const next = (current + direction + ids.length) % ids.length;
    this.focusCard(ids[next] as string);
  }

  /** The draft comment card, with the mention picker scoped to this proposal. */
  openDraft(span: Span): void {
    if (span.length === 0) return;
    this.closeDraft();
    const box = el('textarea', { class: 'reply-box', 'aria-label': 'Comment', rows: '3' });
    const error = el('p', { class: 'field-error' });
    const picker = el('ul', { class: 'mention-picker', role: 'listbox', 'aria-label': 'Mention people', hidden: true });
    const post = el('button', { type: 'button', class: 'card-button', text: 'Post' });
    const cancel = el('button', { type: 'button', class: 'card-button', text: 'Cancel' });
    const card = el('article', { class: 'card comment draft', tabindex: '-1', 'aria-label': 'New comment' }, [
      authorChip(this.session, { personId: this.session.me.personId, displayName: this.session.me.displayName, colour: this.session.me.colour, role: this.session.role }),
      el('p', { class: 'card-anchor', text: `“${this.session.state.text.slice(span.at, span.at + span.length)}”` }),
      box,
      error,
      picker,
      el('div', { class: 'card-actions' }, [post, cancel]),
    ]);
    let mentions: Person[] = [];
    let options: Person[] = [];
    let activeOption = 0;

    const closePicker = (): void => {
      picker.toggleAttribute('hidden', true);
      options = [];
    };

    const renderPicker = (): void => {
      clear(picker);
      options.forEach((person, index) => {
        picker.appendChild(
          el(
            'li',
            {
              role: 'option',
              id: `mention-${person.personId}`,
              'aria-selected': index === activeOption ? 'true' : 'false',
              class: index === activeOption ? 'active' : '',
              onclick: () => choose(person),
            },
            [`${person.displayName} · ${roleLabel(person.role)}`],
          ),
        );
      });
      picker.toggleAttribute('hidden', options.length === 0);
    };

    const choose = (person: Person): void => {
      const value = box.value;
      const at = value.lastIndexOf('@');
      if (at === -1) return;
      box.value = `${value.slice(0, at)}@${person.displayName} `;
      if (!mentions.some((candidate) => candidate.personId === person.personId)) mentions.push(person);
      closePicker();
      box.focus();
    };

    box.addEventListener('input', () => {
      const value = box.value;
      const at = value.lastIndexOf('@');
      if (at === -1 || /\s/u.test(value.slice(at + 1))) {
        closePicker();
        return;
      }
      void api.people(this.session.documentId, value.slice(at + 1)).then((result) => {
        options = result.people.filter((person) => person.personId !== this.session.me.personId);
        activeOption = 0;
        renderPicker();
      });
    });

    box.addEventListener('keydown', (event) => {
      if (options.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          activeOption = (activeOption + 1) % options.length;
          renderPicker();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          activeOption = (activeOption - 1 + options.length) % options.length;
          renderPicker();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          const person = options[activeOption];
          if (person) choose(person);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closePicker();
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeDraft();
        this.page.focusPage();
        this.page.setSelection(span);
      }
    });

    cancel.addEventListener('click', () => {
      this.closeDraft();
      this.page.focusPage();
      this.page.setSelection(span);
    });

    post.addEventListener('click', () => {
      const body = box.value.trim();
      post.disabled = true;
      post.textContent = 'Posting';
      const used = mentions.filter((person) => body.includes(`@${person.displayName}`));
      void api
        .comment(this.session.documentId, { anchor: span, body, mentions: used.map((person) => person.personId) })
        .then(() => {
          announce('Comment posted');
          this.closeDraft();
          this.render();
        })
        .catch((failure: unknown) => {
          if (failure instanceof ApiError && failure.fields) {
            error.textContent = failure.fields.body ?? failure.fields.anchor ?? failure.fields.mentions ?? '';
            box.focus();
          }
        })
        .finally(() => {
          post.disabled = false;
          post.textContent = 'Post';
        });
    });

    this.draft = { span, element: card };
    this.render();
    box.focus();
  }

  closeDraft(): void {
    if (!this.draft) return;
    this.draft = null;
    this.render();
  }

  /** A settled card folds shut while the cards below glide up, tethers redrawn each frame. */
  settle(id: string): void {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    const element = entry.element;
    element.classList.add('settling');
    this.ghosts.push(element);
    const started = performance.now();
    const step = (): void => {
      this.layout();
      if (performance.now() - started < 400) {
        requestAnimationFrame(step);
        return;
      }
      element.remove();
      this.ghosts = this.ghosts.filter((ghost) => ghost !== element);
      this.layout();
    };
    requestAnimationFrame(step);
  }

  render(): void {
    const cards = this.orderedCards();
    const host = this.isPhone ? this.sheetHost : this.column;
    const other = this.isPhone ? this.column : this.sheetHost;
    clear(other);
    clear(host);
    for (const ghost of this.ghosts) host.appendChild(ghost);
    this.entries = [];
    const markers = this.markers();
    for (const card of cards) {
      const element = card.render();
      if (this.isPhone) {
        const number = markers.get(card.id);
        if (number !== undefined) element.prepend(el('p', { class: 'card-number', text: `Card ${number}` }));
      }
      if (card.id === this.focusedCardId) element.classList.add('focused');
      host.appendChild(element);
      this.entries.push({ id: card.id, at: card.at, element, colour: card.colour, lastTop: 0 });
    }
    if (this.draft) {
      host.appendChild(this.draft.element);
      this.entries.push({ id: 'draft', at: this.draft.span.at, element: this.draft.element, colour: this.session.me.colour, lastTop: 0 });
    }
    this.layout();
    this.onLayoutChange();
  }

  layout(): void {
    if (this.isPhone) {
      clear(this.tetherLayer);
      return;
    }
    const hostRect = this.column.getBoundingClientRect();
    let previousBottom = -Infinity;
    for (const entry of this.entries) {
      const anchored = this.page.element.querySelector(`[data-anchor-for="${CSS.escape(entry.id)}"]`);
      const rect = anchored?.getClientRects()[0];
      const desired = rect ? rect.top - hostRect.top : entry.lastTop;
      const top = Math.max(desired, previousBottom + 8);
      entry.element.style.top = `${Math.max(0, top)}px`;
      entry.lastTop = top;
      previousBottom = top + entry.element.offsetHeight;
    }
    this.drawTethers();
  }

  private drawTethers(): void {
    clear(this.tetherLayer);
    const layerRect = this.tetherLayer.getBoundingClientRect();
    this.tetherLayer.setAttribute('viewBox', `0 0 ${layerRect.width} ${layerRect.height}`);
    for (const entry of this.entries) {
      const anchored = this.page.element.querySelector(`[data-anchor-for="${CSS.escape(entry.id)}"]`);
      if (!anchored) continue;
      const rects = anchored.getClientRects();
      const last = rects[rects.length - 1];
      if (!last) continue;
      const cardRect = entry.element.getBoundingClientRect();
      const line = svg('line', {
        x1: last.right - layerRect.left,
        y1: last.top + last.height / 2 - layerRect.top,
        x2: cardRect.left - layerRect.left,
        y2: cardRect.top + 12 - layerRect.top,
        'data-tether-for': entry.id,
        stroke: entry.colour,
        'stroke-width': entry.id === this.focusedCardId ? 2 : 1,
      });
      this.tetherLayer.appendChild(line);
    }
  }
}
