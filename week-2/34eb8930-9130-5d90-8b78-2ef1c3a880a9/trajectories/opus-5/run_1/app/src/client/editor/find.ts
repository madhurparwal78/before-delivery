import { findMatches, openSuggestionSpans } from '../../shared/doc.js';
import type { Span } from '../../shared/types.js';
import { el, escapeCloses, trapFocus } from '../dom.js';
import { announce } from '../shell.js';
import type { PageView } from './page.js';
import type { EditorSession } from './session.js';

/** The Find and replace dialog: a modal that keeps Tab inside itself. */
export class FindDialog {
  private element: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  private opener: HTMLElement | null = null;
  private matches: Span[] = [];
  private current = -1;
  private stepped = false;
  private announceTimer: number | null = null;

  constructor(
    private readonly session: EditorSession,
    private readonly page: PageView,
    private readonly onDecorationsChange: () => void,
  ) {}

  get open(): boolean {
    return this.element !== null;
  }

  show(opener: HTMLElement | null): void {
    if (this.element) {
      this.element.querySelector<HTMLInputElement>('.find-input')?.focus();
      return;
    }
    this.opener = opener;
    const findInput = el('input', { type: 'text', class: 'find-input', 'aria-label': 'Find' });
    const replaceInput = el('input', { type: 'text', 'aria-label': 'Replace with' });
    const matchCase = el('input', { type: 'checkbox', id: 'find-match-case' });
    const count = el('p', { class: 'find-count', text: 'No matches' });
    const previous = el('button', { type: 'button', class: 'card-button', 'aria-label': 'Previous match', text: 'Previous' });
    const next = el('button', { type: 'button', class: 'card-button', 'aria-label': 'Next match', text: 'Next' });
    const replace = el('button', { type: 'button', class: 'card-button', text: 'Replace' });
    const replaceAll = el('button', { type: 'button', class: 'card-button', text: 'Replace all' });
    const close = el('button', { type: 'button', class: 'card-button', text: 'Close' });

    const search = (announceCount: boolean): void => {
      const term = findInput.value;
      this.matches = findMatches(this.session.state.text, term, matchCase.checked, openSuggestionSpans(this.session.state));
      this.current = this.matches.length > 0 ? 0 : -1;
      this.stepped = false;
      this.updateCount(count);
      this.onDecorationsChange();
      if (!announceCount) return;
      if (this.announceTimer !== null) clearTimeout(this.announceTimer);
      this.announceTimer = window.setTimeout(() => {
        announce(count.textContent ?? '');
      }, 333);
    };

    const step = (direction: 1 | -1): void => {
      if (this.matches.length === 0) return;
      this.stepped = true;
      this.current = (this.current + direction + this.matches.length) % this.matches.length;
      this.updateCount(count);
      this.onDecorationsChange();
      const match = this.matches[this.current];
      if (match) {
        this.page.setSelection(match);
        const point = this.page.pointOf(match.at);
        const node = point.node.nodeType === Node.TEXT_NODE ? point.node.parentElement : (point.node as HTMLElement);
        node?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    };

    findInput.addEventListener('input', () => search(true));
    matchCase.addEventListener('change', () => search(true));
    findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      }
    });
    next.addEventListener('click', () => step(1));
    previous.addEventListener('click', () => step(-1));
    replace.addEventListener('click', () => {
      const match = this.matches[this.current];
      if (!match || this.session.mode === 'viewing') return;
      this.page.setSelection(match);
      this.page.insertText(replaceInput.value);
      search(false);
    });
    replaceAll.addEventListener('click', () => {
      if (this.session.mode === 'viewing' || findInput.value.length === 0) return;
      const suggesting = this.session.mode === 'suggesting';
      void this.session.replaceAll(findInput.value, replaceInput.value, matchCase.checked).then((replaced) => {
        announce(
          suggesting
            ? replaced === 1
              ? 'Suggested 1 replacement'
              : `Suggested ${replaced} replacements`
            : replaced === 1
              ? 'Replaced 1 match'
              : `Replaced ${replaced} matches`,
        );
        search(false);
      });
    });
    close.addEventListener('click', () => this.hide());

    const dialog = el('div', { class: 'dialog find-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Find and replace' }, [
      el('h2', { text: 'Find and replace' }),
      el('div', { class: 'field' }, [el('label', { text: 'Find' }), findInput]),
      el('div', { class: 'field' }, [el('label', { text: 'Replace with' }), replaceInput]),
      el('div', { class: 'field inline' }, [matchCase, el('label', { for: 'find-match-case', text: 'Match case' })]),
      count,
      el('div', { class: 'dialog-actions' }, [previous, next, replace, replaceAll, close]),
    ]);
    const backdrop = el('div', { class: 'backdrop light' }, [dialog]);
    trapFocus(dialog);
    escapeCloses(dialog, () => this.hide());
    document.body.appendChild(backdrop);
    this.element = dialog;
    this.backdrop = backdrop;
    replace.disabled = this.session.mode === 'viewing';
    replaceAll.disabled = this.session.mode === 'viewing';
    replaceInput.disabled = this.session.mode === 'viewing';
    findInput.focus();
    search(false);
  }

  private updateCount(count: HTMLElement): void {
    const total = this.matches.length;
    if (total === 0) {
      count.textContent = 'No matches';
      return;
    }
    count.textContent = this.stepped && this.current >= 0
      ? `Match ${this.current + 1} of ${total}`
      : total === 1
        ? '1 match'
        : `${total} matches`;
  }

  hide(): void {
    if (!this.element) return;
    this.backdrop?.remove();
    this.element = null;
    this.backdrop = null;
    this.matches = [];
    this.current = -1;
    this.stepped = false;
    this.onDecorationsChange();
    if (this.opener) this.opener.focus();
    else this.page.focusPage();
  }

  decorations(): { matches: Span[]; currentMatch: number } {
    return { matches: this.matches, currentMatch: this.current };
  }
}
