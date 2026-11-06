import { element } from '../dom';

export interface MenuItem {
  readonly label: string;
  readonly activate: () => void;
}

/** A keyboard menu: a menu button with its menu of menuitems. */
export class HeaderMenu {
  readonly node: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private menu: HTMLElement | null = null;
  private items: HTMLElement[] = [];

  constructor(
    private readonly name: string,
    private readonly entries: readonly MenuItem[],
  ) {
    this.trigger = element('button', {
      text: name,
      className: 'control menu-button',
      attributes: { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    });
    this.trigger.append(element('span', { className: 'menu-chevron', attributes: { 'aria-hidden': 'true' } }));
    this.trigger.addEventListener('click', () => (this.menu === null ? this.open(0) : this.close()));
    this.trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.open(0);
      }
    });
    this.node = element('div', { className: 'menu-host', children: [this.trigger] });
    document.addEventListener('mousedown', (event) => {
      if (this.menu === null) return;
      if (!this.node.contains(event.target as Node)) this.close();
    });
  }

  private open(startAt: number): void {
    if (this.menu !== null) {
      this.items[startAt]?.focus();
      return;
    }
    const menu = element('div', {
      className: 'menu',
      attributes: { role: 'menu', 'aria-label': this.name },
    });
    this.items = this.entries.map((entry) => {
      const item = element('button', {
        text: entry.label,
        className: 'control menu-item',
        attributes: { type: 'button', role: 'menuitem', tabindex: '-1' },
      });
      item.addEventListener('click', () => {
        this.close();
        entry.activate();
      });
      menu.append(item);
      return item;
    });
    menu.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.menu = menu;
    this.node.append(menu);
    this.trigger.setAttribute('aria-expanded', 'true');
    this.items[startAt]?.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const at = this.items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      this.trigger.focus();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.items[(at + 1) % this.items.length].focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.items[(at - 1 + this.items.length) % this.items.length].focus();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.items[0].focus();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      this.items[this.items.length - 1].focus();
    }
  }

  close(): void {
    this.menu?.remove();
    this.menu = null;
    this.items = [];
    this.trigger.setAttribute('aria-expanded', 'false');
  }
}
