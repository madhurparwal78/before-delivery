import { el } from '../dom.js';

export interface MenuItem {
  label: string;
  choose: () => void;
}

export function openMenu(opener: HTMLElement, name: string, items: MenuItem[]): void {
  const menu = el('div', { role: 'menu', 'aria-label': name, class: 'menu' });
  const buttons = items.map((item) =>
    el('button', { type: 'button', role: 'menuitem', class: 'menu-item', tabindex: '-1', text: item.label }),
  );
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      close();
      items[index].choose();
    });
    menu.append(button);
  });
  const box = opener.getBoundingClientRect();
  menu.style.left = `${box.left + window.scrollX}px`;
  menu.style.top = `${box.bottom + window.scrollY + 4}px`;
  document.body.append(menu);

  let active = 0;
  const focusActive = (): void => {
    buttons[active]?.focus();
  };

  function close(focusOpener = true): void {
    menu.remove();
    document.removeEventListener('pointerdown', onPointerDown, true);
    if (focusOpener && opener.isConnected) opener.focus();
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!menu.contains(event.target as Node)) close(false);
  };
  document.addEventListener('pointerdown', onPointerDown, true);

  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      active = Math.min(buttons.length - 1, active + 1);
      focusActive();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      active = Math.max(0, active - 1);
      focusActive();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      close();
    }
  });
  focusActive();
}
