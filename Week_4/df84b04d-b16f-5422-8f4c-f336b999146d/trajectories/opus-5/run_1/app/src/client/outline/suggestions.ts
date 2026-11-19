import type { Suggestion } from '../../shared/types.js';
import { clear, el } from '../dom.js';

/** The tag and mention suggestions listbox under the bullet being typed in. */
export class Suggestions {
  private box: HTMLElement | null = null;
  private options: HTMLElement[] = [];
  private highlighted = 0;
  private onTake_: ((value: string) => void) | null = null;

  isOpen(): boolean {
    return this.box !== null;
  }

  open(anchor: HTMLElement, items: Suggestion[], onTake: (value: string) => void): void {
    this.close();
    const box = el('ul', { role: 'listbox', class: 'suggestions', 'aria-label': 'Suggestions' });
    this.options = items.map((item, index) =>
      el(
        'li',
        {
          role: 'option',
          class: 'suggestion',
          'aria-selected': index === 0 ? 'true' : 'false',
          'aria-label': item.value
        },
        [item.value]
      )
    );
    for (const [index, option] of this.options.entries()) {
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.highlighted = index;
        this.take();
      });
      box.append(option);
    }
    const row = anchor.closest<HTMLElement>('.row') ?? anchor;
    row.append(box);
    this.box = box;
    this.highlighted = 0;
    this.onTake_ = onTake;
  }

  move(delta: number): void {
    if (this.box === null || this.options.length === 0) return;
    this.highlighted =
      (this.highlighted + delta + this.options.length) % this.options.length;
    for (const [index, option] of this.options.entries()) {
      option.setAttribute('aria-selected', index === this.highlighted ? 'true' : 'false');
    }
  }

  take(): void {
    const option = this.options[this.highlighted];
    const onTake = this.onTake_;
    const value = option?.textContent ?? '';
    this.close();
    if (onTake !== null && value !== '') onTake(value);
  }

  close(): void {
    if (this.box !== null) {
      clear(this.box);
      this.box.remove();
    }
    this.box = null;
    this.options = [];
    this.onTake_ = null;
  }
}
