/** Desk messages and Table news. */

import { MESSAGE_LIFETIME_MS } from '../shared/timing.js';
import { el, setText } from './dom.js';

export class DeskMessages {
  readonly region: HTMLElement;
  private clearing: number | null = null;

  constructor() {
    this.region = el('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Desk messages', class: 'desk-messages' });
  }

  /** Pending copy stays until its result arrives. */
  pending(copy: string): void {
    this.stopClearing();
    setText(this.region, copy);
  }

  /** Result copy stays exactly the message lifetime, then the region empties. */
  result(copy: string): void {
    this.stopClearing();
    setText(this.region, copy);
    this.clearing = window.setTimeout(() => {
      setText(this.region, '');
      this.clearing = null;
    }, MESSAGE_LIFETIME_MS);
  }

  private stopClearing(): void {
    if (this.clearing !== null) window.clearTimeout(this.clearing);
    this.clearing = null;
  }
}

export class TableNews {
  readonly region: HTMLElement;

  constructor() {
    this.region = el('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Table news', class: 'table-news' });
  }

  /** Table news keeps its latest announcement until the next one. */
  announce(copy: string): void {
    setText(this.region, copy);
  }
}
