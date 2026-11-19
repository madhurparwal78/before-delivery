import { h } from '../dom';

export interface TabSpec {
  name: string;
  panel: HTMLElement;
}

export interface Tabs {
  list: HTMLElement;
  panels: HTMLElement;
  select: (index: number) => void;
  selected: () => number;
}

let tabCount = 0;

/**
 * Only the selected tab is in the tab order; arrows move focus and wrap, and Enter or Space
 * selects. Unselected panels are hidden and inert.
 */
export const tablist = (label: string, specs: readonly TabSpec[], initial = 0): Tabs => {
  tabCount += 1;
  const prefix = `tabs-${tabCount}`;
  let chosen = initial;

  const buttons = specs.map((spec, index) =>
    h('button', {
      type: 'button',
      role: 'tab',
      id: `${prefix}-tab-${index}`,
      'aria-controls': `${prefix}-panel-${index}`,
      'aria-selected': 'false',
      tabindex: '-1',
      class: 'tab',
      text: spec.name,
    }),
  );

  const list = h('div', { role: 'tablist', 'aria-label': label, class: 'tablist' }, buttons);
  const panels = h('div', { class: 'tabpanels' });
  specs.forEach((spec, index) => {
    spec.panel.setAttribute('role', 'tabpanel');
    spec.panel.setAttribute('aria-label', spec.name);
    spec.panel.id = `${prefix}-panel-${index}`;
    spec.panel.setAttribute('aria-labelledby', `${prefix}-tab-${index}`);
    panels.appendChild(spec.panel);
  });

  const select = (index: number): void => {
    chosen = index;
    buttons.forEach((button, position) => {
      const active = position === index;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
      button.classList.toggle('current', active);
    });
    specs.forEach((spec, position) => {
      const active = position === index;
      spec.panel.hidden = !active;
      if (active) spec.panel.removeAttribute('inert');
      else spec.panel.setAttribute('inert', '');
    });
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        buttons[(index + 1) % buttons.length]!.focus();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        buttons[(index - 1 + buttons.length) % buttons.length]!.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        buttons[0]!.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        buttons[buttons.length - 1]!.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(index);
      }
    });
  });

  select(initial);
  return { list, panels, select, selected: () => chosen };
};
