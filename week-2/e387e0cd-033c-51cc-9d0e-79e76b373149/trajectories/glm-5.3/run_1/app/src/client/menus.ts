// Header menus (keyboard menus): arrows with wrapping, Home and End, Enter
// activates, Escape closes and returns focus, clicking outside closes.
import { h } from './dom.js';

export function menuButton(label: string, items: { label: string; onActivate: () => void }[], placement: 'header' | 'inline'): HTMLElement {
  const btn = h('button', { type: 'button', class: 'menu-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label }, label, h('span', { class: 'chevron', 'aria-hidden': 'true' }, '▾'));
  let menu: HTMLElement | null = null;
  const keydownHandler = { current: null as ((e: KeyboardEvent) => void) | null };
  const outsideHandler = { current: null as ((e: PointerEvent) => void) | null };

  const closeMenu = (): void => {
    if (menu === null) return;
    if (keydownHandler.current !== null) document.removeEventListener('keydown', keydownHandler.current, true);
    if (outsideHandler.current !== null) document.removeEventListener('pointerdown', outsideHandler.current);
    menu.remove();
    menu = null;
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  };

  const openMenu = (): void => {
    if (menu !== null) {
      closeMenu();
      return;
    }
    menu = h('div', { role: 'menu', 'aria-label': label, class: `menu ${placement}` });
    items.forEach((item) => {
      const menuItem = h('div', { role: 'menuitem', class: 'menu-item', tabindex: '-1' }, item.label);
      menuItem.addEventListener('click', () => {
        closeMenu();
        item.onActivate();
      });
      menu!.append(menuItem);
    });
    btn.after(menu);
    btn.setAttribute('aria-expanded', 'true');
    (menu.querySelector('[role="menuitem"]') as HTMLElement).focus();

    keydownHandler.current = (e: KeyboardEvent): void => {
      const itemsEl = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const current = menu?.querySelector<HTMLElement>('[role="menuitem"]:focus');
      const index = current !== null && current !== undefined ? itemsEl.indexOf(current) : -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        itemsEl[(index + 1) % itemsEl.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        itemsEl[(index - 1 + itemsEl.length) % itemsEl.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        itemsEl[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        itemsEl[itemsEl.length - 1]?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const target = index >= 0 ? itemsEl[index] : null;
        if (target !== null) {
          closeMenu();
          items[index]?.onActivate();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
      }
    };
    document.addEventListener('keydown', keydownHandler.current, true);
    outsideHandler.current = (e: PointerEvent): void => {
      if (menu !== null && !menu.contains(e.target as Node) && !btn.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('pointerdown', outsideHandler.current);
  };

  btn.addEventListener('click', openMenu);
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    }
  });
  return btn;
}
