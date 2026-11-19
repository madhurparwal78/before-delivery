import { listen, onFrame, query, queryAll } from './dom.js';
import { EASE_OUT, animate, reduced } from './motion.js';
import { onReveal } from './reveal.js';
import { afterLoad, jumpToSection } from './focus.js';
import { writeHash } from './params.js';
import { updateCurrentLinks } from './chrome.js';
import { initStats } from './stats.js';
import { initServices } from './services.js';
import { initWork } from './work.js';
import { initProcess } from './process.js';
import { initForm } from './form.js';
import { SECTIONS } from '../content/copy.js';

const INTRO_LINE_MS = 700;
const INTRO_LINE_STAGGER_MS = 120;
const HEADING_MS = 600;
const PARALLAX_LIMIT = 800;
const PARALLAX_FACTOR = 0.25;

const SECTION_IDS = SECTIONS.map((section) => section.id);

function raiseIntroLines(root: ParentNode): void {
  queryAll<HTMLElement>('[data-line]', root).forEach((line, index) => {
    animate(line, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], {
      duration: INTRO_LINE_MS,
      delay: index * INTRO_LINE_STAGGER_MS,
      easing: EASE_OUT,
      fill: 'backwards',
    });
  });
}

function revealHeadings(root: ParentNode): void {
  for (const heading of queryAll<HTMLElement>('[data-section-heading]', root)) {
    if (heading.dataset.revealed === 'done') continue;
    onReveal(heading, 0.85, () => {
      heading.dataset.revealed = 'done';
      animate(
        heading,
        [
          { transform: 'translateY(32px)', opacity: '0' },
          { transform: 'translateY(0)', opacity: '1' },
        ],
        { duration: HEADING_MS, easing: EASE_OUT, fill: 'backwards' },
      );
    });
  }
}

function followScroll(root: ParentNode): void {
  const plate = query<HTMLElement>('[data-parallax]', root);
  const sections = queryAll<HTMLElement>('section[id]', root);

  const update = (): void => {
    if (plate && !reduced()) {
      const offset = Math.round(PARALLAX_FACTOR * Math.min(window.scrollY, PARALLAX_LIMIT));
      plate.style.transform = `translateY(${offset}px)`;
    }
    const line = window.innerHeight * 0.4;
    const active = sections.find((section) => {
      const box = section.getBoundingClientRect();
      return box.top <= line && box.bottom > line;
    });
    const id = active ? active.id : null;
    updateCurrentLinks(id === 'intro' || id === undefined ? null : id);
  };

  listen(window, 'scroll', () => onFrame(update), { passive: true });
  listen(window, 'resize', () => onFrame(update));
  update();
}

function interceptJumps(): void {
  listen(document, 'click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const url = new URL(link.href);
    if (url.origin !== window.location.origin || url.pathname !== '/' || url.hash === '') return;
    const id = url.hash.slice(1);
    if (!SECTION_IDS.includes(id as (typeof SECTION_IDS)[number])) return;
    event.preventDefault();
    writeHash(url.hash);
    jumpToSection(id);
  });
}

export function initHome(root: HTMLElement, first: boolean): void {
  initStats(root);
  initServices(root, first);
  initWork(root);
  initProcess(root);
  initForm(root);
  revealHeadings(root);
  followScroll(root);
  interceptJumps();
  if (first) {
    raiseIntroLines(root);
    const id = window.location.hash.slice(1);
    if (SECTION_IDS.includes(id as (typeof SECTION_IDS)[number])) {
      afterLoad(() => jumpToSection(id, true));
    }
  }
}
