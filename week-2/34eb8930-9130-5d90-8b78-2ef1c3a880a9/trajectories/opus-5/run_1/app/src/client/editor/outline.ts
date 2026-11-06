import { blocksOf } from '../../shared/doc.js';
import type { Block } from '../../shared/types.js';
import { clear, el } from '../dom.js';
import type { PageView } from './page.js';
import type { EditorSession } from './session.js';

const HEADING_STYLES = new Set<Block['style']>(['title', 'heading1', 'heading2', 'heading3']);

/** The Outline rail: every title and heading in page order. */
export class Outline {
  readonly element: HTMLElement;
  private readonly listbox: HTMLElement;
  private active = 0;

  constructor(
    private readonly session: EditorSession,
    private readonly page: PageView,
  ) {
    this.listbox = el('ul', { class: 'outline-list', role: 'listbox', 'aria-label': 'Headings', tabindex: '0' });
    this.element = el('nav', { class: 'outline', 'aria-label': 'Outline' }, [this.listbox]);
    this.listbox.addEventListener('keydown', (event) => this.onKeyDown(event as KeyboardEvent));
  }

  private headings(): Block[] {
    return blocksOf(this.session.state).filter((block) => HEADING_STYLES.has(block.style));
  }

  private onKeyDown(event: KeyboardEvent): void {
    const headings = this.headings();
    if (headings.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.active = Math.min(this.active + 1, headings.length - 1);
      this.render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.active = Math.max(this.active - 1, 0);
      this.render();
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.active = 0;
      this.render();
    } else if (event.key === 'End') {
      event.preventDefault();
      this.active = headings.length - 1;
      this.render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.jump(this.active);
    }
  }

  jump(index: number): void {
    const heading = this.headings()[index];
    if (!heading) return;
    this.active = index;
    this.page.focusPage();
    this.page.setSelection({ at: heading.at, length: 0 });
    const point = this.page.pointOf(heading.at);
    const element = (point.node.nodeType === Node.TEXT_NODE ? point.node.parentElement : (point.node as HTMLElement)) ?? null;
    element?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }

  render(): void {
    const headings = this.headings();
    clear(this.listbox);
    headings.forEach((heading, index) => {
      const option = el('li', {
        role: 'option',
        class: `outline-option ${heading.style}${index === this.active ? ' active' : ''}`,
        'aria-selected': index === this.active ? 'true' : 'false',
        text: this.session.state.text.slice(heading.at, heading.at + heading.length),
        onclick: () => this.jump(index),
      });
      this.listbox.appendChild(option);
    });
    const activeOption = this.listbox.children[this.active] as HTMLElement | undefined;
    if (activeOption) {
      activeOption.id = activeOption.id || `outline-option-${this.active}`;
      this.listbox.setAttribute('aria-activedescendant', activeOption.id);
    }
  }
}
