import { el } from './dom.ts';

/** A polite live region whose last text stays until something new is said. */
export class LiveRegion {
  readonly element: HTMLElement;

  constructor(label: string) {
    this.element = el('div', { role: 'status', 'aria-live': 'polite', 'aria-label': label, class: 'live-region' });
  }

  say(text: string): void {
    if (this.element.textContent === text) {
      this.element.textContent = '';
    }
    this.element.textContent = text;
  }

  get text(): string {
    return this.element.textContent ?? '';
  }

  restore(text: string): void {
    this.element.textContent = text;
  }
}
