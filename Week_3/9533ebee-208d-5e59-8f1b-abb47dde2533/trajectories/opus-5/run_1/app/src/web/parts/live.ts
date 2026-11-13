/**
 * The two live regions. Both are always in the page, so a new message
 * replaces the old one in place. Success and pending copy goes to
 * Announcements; conflicts, outages and network failures go to Problems.
 */

import { ApiProblem, NetworkFailure } from '../api.ts';
import { el, clear } from '../dom.ts';

export class LiveRegions {
  readonly announcements: HTMLElement;
  readonly problems: HTMLElement;

  constructor() {
    this.announcements = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Announcements',
      class: 'announcements',
    });
    this.problems = el('div', {
      role: 'alert',
      'aria-label': 'Problems',
      class: 'problems',
    });
  }

  /** Success and pending copy, optionally with a receipt link. */
  announce(text: string, receipt?: { href: string; label: string }): void {
    clear(this.announcements);
    if (text === '') return;
    this.announcements.append(document.createTextNode(text));
    if (receipt !== undefined) {
      this.announcements.append(
        document.createTextNode(' '),
        el('a', { href: receipt.href, 'data-route': 'true', text: receipt.label }),
      );
    }
  }

  /** Keeps the last announcement through a refresh. */
  get announcementText(): string {
    return this.announcements.textContent ?? '';
  }

  clearProblems(): void {
    clear(this.problems);
  }

  /** A conflict, outage or network failure, showing the detail verbatim. */
  problem(text: string): void {
    clear(this.problems);
    this.problems.append(document.createTextNode(text));
  }

  /**
   * A validation summary with one link per invalid field, each moving focus
   * to its field.
   */
  validation(fields: ReadonlyArray<{ name: string; label: string; focus: () => void }>): void {
    clear(this.problems);
    this.problems.append(document.createTextNode('Check the highlighted fields.'));
    const list = el('ul', { class: 'problem-fields' });
    for (const field of fields) {
      const link = el('a', { href: '#', text: field.label, class: 'field-link' });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        field.focus();
      });
      list.append(el('li', {}, [link]));
    }
    this.problems.append(list);
  }

  /** Reports a failure through the rules the brief sets for each kind. */
  report(error: unknown): void {
    if (error instanceof NetworkFailure) {
      this.problem(error.message);
      return;
    }
    if (error instanceof ApiProblem) {
      this.problem(error.detail);
      return;
    }
    this.problem('Something went wrong on our side \u2013 nothing is confirmed.');
  }
}
