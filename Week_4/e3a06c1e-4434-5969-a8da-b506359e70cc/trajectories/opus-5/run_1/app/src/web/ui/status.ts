import { el } from '../dom.js';

/** A named polite status region. Announcing never moves focus. */
export class StatusRegion {
  readonly node: HTMLElement;
  private last: string | null = null;

  constructor(name: string, extraClass = '') {
    this.node = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': name,
      class: `status-region ${extraClass}`.trim(),
    });
  }

  set(message: string): void {
    this.last = message;
    this.node.textContent = message;
  }

  banner(message: string, tone: 'caution' | 'plain'): void {
    if (this.last === message) return;
    this.last = message;
    this.node.textContent = '';
    this.node.append(el('p', { class: `banner banner-${tone}`, text: message }));
  }

  clear(): void {
    this.last = null;
    this.node.textContent = '';
  }

  get text(): string {
    return this.node.textContent ?? '';
  }
}
