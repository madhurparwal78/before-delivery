/** The skill groups: tabs that select on focus, technology cards and the bars. */

import { COUNTER_LINE } from '../shared/rules.js';
import { need, onScrollOrResize, queryAll, reducedMotion, setHidden } from './dom.js';

const BAR_MS = 600;
const BAR_STAGGER_MS = 80;

const growBars = (panel: HTMLElement): void => {
  if (reducedMotion()) return;
  queryAll<HTMLElement>('[data-skill]', panel).forEach((card, index) => {
    const bar = need<HTMLElement>('[data-meter-bar]', card);
    const level = need<HTMLElement>('.meter', card).getAttribute('aria-valuenow') ?? '0';
    for (const animation of bar.getAnimations()) animation.cancel();
    bar.animate([{ width: '0%' }, { width: `${level}%` }], {
      duration: BAR_MS,
      delay: index * BAR_STAGGER_MS,
      easing: 'ease',
      fill: 'backwards',
    });
  });
};

export const setUpSkills = (): void => {
  const tabs = queryAll<HTMLButtonElement>('[data-tab]');
  const panels = queryAll<HTMLElement>('[data-skill-panel]');

  const panelFor = (id: string): HTMLElement => need(`[data-skill-panel="${id}"]`);

  const select = (id: string, moveFocus: boolean): void => {
    for (const tab of tabs) {
      const chosen = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', chosen ? 'true' : 'false');
      tab.tabIndex = chosen ? 0 : -1;
      if (chosen && moveFocus) tab.focus({ preventScroll: true });
    }
    for (const panel of panels) setHidden(panel, panel.dataset.skillPanel !== id);
    growBars(panelFor(id));
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.dataset.tab ?? '', false));
    tab.addEventListener('keydown', (event) => {
      const last = tabs.length - 1;
      let next: number | null = null;
      if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
      else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      if (next === null) return;
      event.preventDefault();
      select(tabs[next]?.dataset.tab ?? '', true);
    });
  });

  for (const panel of panels) {
    const cards = queryAll<HTMLElement>('[data-skill]', panel);
    for (const card of cards) {
      const button = need<HTMLButtonElement>('.skill-button', card);
      const detail = need<HTMLElement>('.skill-detail', card);
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') === 'true';
        for (const other of cards) {
          if (other === card) continue;
          need<HTMLButtonElement>('.skill-button', other).setAttribute('aria-expanded', 'false');
          setHidden(need<HTMLElement>('.skill-detail', other), true);
        }
        button.setAttribute('aria-expanded', open ? 'false' : 'true');
        setHidden(detail, open);
      });
    }
  }

  // The first panel's bars grow when the section reaches the 75% line.
  const section = need<HTMLElement>('#skills');
  let grown = false;
  onScrollOrResize(() => {
    if (grown) return;
    if (section.getBoundingClientRect().top > window.innerHeight * COUNTER_LINE) return;
    grown = true;
    const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    if (selected !== undefined) growBars(panelFor(selected.dataset.tab ?? ''));
  });
};
