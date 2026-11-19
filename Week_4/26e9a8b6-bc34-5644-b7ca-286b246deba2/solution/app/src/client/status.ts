import { h } from './dom';

type Tone = 'info' | 'error';

/** A polite live region. Errors render as a full-width maroon band; a newer message restarts the expiry timer. */
export class Status {
  readonly element: HTMLElement;
  private timer = 0;

  constructor(name: string, extraClass = '') {
    this.element = h('p', { role: 'status', 'aria-label': name, class: `status ${extraClass}`.trim(), 'data-tone': 'info' });
  }

  set(text: string, tone: Tone = 'info'): void {
    clearTimeout(this.timer);
    this.element.textContent = text;
    this.element.dataset.tone = tone;
  }

  /** Shows an outcome that clears after `ms` of page time unless a newer message arrives first. */
  flash(text: string, tone: Tone = 'info', ms = 5000): void {
    this.set(text, tone);
    this.timer = window.setTimeout(() => {
      this.element.textContent = '';
    }, ms);
  }

  clear(): void {
    this.set('');
  }
}
