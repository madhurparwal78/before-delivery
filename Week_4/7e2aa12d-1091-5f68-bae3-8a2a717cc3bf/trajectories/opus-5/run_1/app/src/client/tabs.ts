import { h } from './dom.js';

export interface TabDefinition {
  id: string;
  label: string;
  /** Lets a rebuilt tablist put focus back where it was. */
  focusKey?: string;
}

export interface TabStrip {
  list: HTMLElement;
  select(id: string): void;
  selected(): string;
}

/** A tablist whose arrow keys move between tabs and whose panels show one at a time. */
export function tabStrip(
  label: string,
  tabs: TabDefinition[],
  initial: string,
  onSelect: (id: string) => void,
): TabStrip {
  let current = initial;
  const list = h('div', { role: 'tablist', 'aria-label': label, class: 'tablist' });
  const buttons = new Map<string, HTMLElement>();

  const apply = (id: string, notify: boolean): void => {
    current = id;
    for (const [key, button] of buttons) {
      const chosen = key === id;
      button.setAttribute('aria-selected', chosen ? 'true' : 'false');
      button.setAttribute('tabindex', chosen ? '0' : '-1');
    }
    if (notify) onSelect(id);
  };

  tabs.forEach((tab) => {
    const button = h('button', {
      type: 'button',
      role: 'tab',
      id: `tab-${tab.id}`,
      'aria-controls': `panel-${tab.id}`,
      'aria-selected': 'false',
      tabindex: '-1',
      class: 'tab',
      'data-focus-key': tab.focusKey,
      text: tab.label,
      onclick: () => apply(tab.id, true),
      onkeydown: (event: Event) => {
        const key = (event as KeyboardEvent).key;
        const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        const index = tabs.findIndex((item) => item.id === current);
        const next = tabs[Math.min(Math.max(index + step, 0), tabs.length - 1)];
        if (!next) return;
        apply(next.id, true);
        buttons.get(next.id)?.focus();
      },
    });
    buttons.set(tab.id, button);
    list.append(button);
  });

  apply(initial, false);
  return {
    list,
    select: (id: string) => apply(id, false),
    selected: () => current,
  };
}
