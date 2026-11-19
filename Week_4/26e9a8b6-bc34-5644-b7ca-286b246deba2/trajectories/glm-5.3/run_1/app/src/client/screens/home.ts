// Home `/`: the waterline hero and the first seeded guide's opening.

import { el } from '../dom';
import { api } from '../api';
import type { GuideReadingJson } from './reader';

export function renderHome(main: HTMLElement): void {
  main.textContent = '';
  const hero = el('section', { class: 'hero', 'aria-label': 'Pennywasher Works' });
  const headline = el('h1', { class: 'hero__headline' });
  headline.append(el('span', { class: 'line' }, 'TAKE IT'));
  const apart = el('span', { class: 'line', 'aria-hidden': 'true' }, 'APART.');
  const apartVisible = el('span', { class: 'line ink-line' }, 'APART.');
  const seam = el('span', { class: 'hero__seam-copy' });
  seam.append(el('span', { class: 'line' }, 'TAKE IT'), apart);
  headline.append(apartVisible);
  hero.append(headline);
  hero.append(el('a', { class: 'pw-btn pw-btn--slate hero__cta', href: '/dashboard' }, 'Start a guide'));
  hero.append(el('p', { class: 'hero__support' }, 'Upload the thing you fixed, and readers watch it come apart one step at a time.'));
  main.append(hero);

  // The seeded coffee grinder guide's first step comes straight after.
  api<GuideReadingJson>('/api/guides/coffee-grinder-fit-new-burrs').then((guide) => {
    const section = el('section', { class: 'home-guide', 'aria-label': 'Featured guide' });
    const heading = el('h2', { class: 'display' }, guide.title);
    const first = guide.steps[0];
    const stepBlock = el('div', { class: 'home-step' });
    stepBlock.append(el('h3', {}, `Step 1: ${first.title}`));
    stepBlock.append(el('p', {}, first.text));
    const links = el('div', { class: 'dialog__row' });
    links.append(el('a', { class: 'pw-btn', href: `/g/${guide.slug}` }, 'Read this guide'));
    links.append(el('a', { class: 'pw-btn', href: '/search' }, 'Find a guide'));
    section.append(heading, stepBlock, links);
    main.append(section);
  }).catch(() => {
    main.append(el('p', { class: 'pw-band' }, 'We could not find that page.'));
  });
}
