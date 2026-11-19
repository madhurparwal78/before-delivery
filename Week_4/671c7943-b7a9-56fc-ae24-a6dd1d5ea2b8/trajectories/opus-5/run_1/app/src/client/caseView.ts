import { listen, onFrame, queryAll } from './dom.js';
import { afterLoad, jumpToSection } from './focus.js';
import { initShowcase } from './showcase.js';
import { CASE_STUDY_SECTIONS } from '../content/copy.js';

const SECTION_IDS = CASE_STUDY_SECTIONS.map((entry) => entry.id);

function followScroll(root: ParentNode): void {
  const links = queryAll<HTMLAnchorElement>('[data-toc]', root);
  const sections = SECTION_IDS.map((id) => root.querySelector<HTMLElement>(`#${id}`));

  const update = (): void => {
    const line = window.innerHeight * 0.4;
    let active: string | null = null;
    sections.forEach((section, index) => {
      if (!section) return;
      const box = section.getBoundingClientRect();
      if (box.top <= line && box.bottom > line) active = SECTION_IDS[index]!;
    });
    for (const link of links) {
      if (active !== null && link.dataset.toc === active) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  };

  listen(window, 'scroll', () => onFrame(update), { passive: true });
  listen(window, 'resize', () => onFrame(update));
  update();
}

export function initCase(root: HTMLElement, first: boolean): void {
  initShowcase(root);
  for (const link of queryAll<HTMLAnchorElement>('[data-toc]', root)) {
    listen(link, 'click', (event) => {
      event.preventDefault();
      jumpToSection(link.dataset.toc!, false);
    });
  }
  followScroll(root);
  if (first) {
    const id = window.location.hash.slice(1);
    if (SECTION_IDS.includes(id as (typeof SECTION_IDS)[number])) {
      afterLoad(() => jumpToSection(id, true));
    }
  }
}
