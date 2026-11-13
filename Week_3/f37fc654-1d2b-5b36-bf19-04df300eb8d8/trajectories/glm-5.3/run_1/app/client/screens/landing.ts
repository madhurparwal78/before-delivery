/** The landing: a scroll-scrubbed stage, typed headline, captions and case studies. */
import { getApp, goto } from '../app.js';
import { el } from '../dom.js';
import { renderTypedHeading, createCursor, prefersReducedMotion } from '../cue-line.js';
import type { RouteContext } from './router.js';

const CASE_STUDIES = [
  {
    title: 'Tidewall',
    blurb: 'A camera-reactive wall at Halsted Works Hall that turns passers-by into slow tides of light.',
    keyframe: 1,
  },
  {
    title: 'Second Face',
    blurb: 'A generative portrait kiosk at Brightwater Atrium that draws each visitor as the person beside them sees them.',
    keyframe: 3,
  },
  {
    title: 'Echo Vault',
    blurb: 'A voice-driven projection room at Lantern Court Museum Lobby where spoken words become falling constellations.',
    keyframe: 4,
  },
];

const CAPTIONS = [
  'A wall that sees the room.',
  "It answers the people in front of it.",
  'Built for one venue, by hand.',
  "Up close, it's light.",
  'In your room, on your day.',
];

export async function landingScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('landing');
  app.main.textContent = '';
  app.main.classList.remove('column-narrow');
  void ctx;

  const hero = el('section', { class: 'landing-hero' });
  const headline = el('h1', { class: 'landing-headline' });
  const cursor = createCursor();
  hero.append(headline, cursor);

  const start = el('a', { href: '/brief/new?step=1', class: 'btn primary cta' }, 'Start a commission');
  start.addEventListener('click', (e) => {
    e.preventDefault();
    goto('/brief/new?step=1');
  });
  hero.append(start);
  app.main.append(hero);

  // The headline types in on the same schedule as a brief question.
  renderTypedHeading(headline, 'Light for dark rooms, made to commission.', cursor, () => undefined);

  // Five caption sections scroll over the stage; the camera scrubs through keyframes.
  for (const [i, caption] of CAPTIONS.entries()) {
    const section = el('section', { class: 'landing-section', 'data-section': String(i) });
    const h2 = el('h2', {}, caption);
    section.append(h2);
    app.main.append(section);
  }

  const recent = el('section', { class: 'landing-recent' });
  recent.append(el('h2', { class: 'recent-title' }, 'Recent commissions'));
  const cards = el('div', { class: 'case-grid' });
  for (const study of CASE_STUDIES) {
    const card = el('button', { class: 'case-card', 'aria-haspopup': 'dialog' }, study.title);
    const blurb = el('p', { class: 'case-blurb' }, study.blurb);
    const inner = el('div', { class: 'case-inner' });
    inner.append(el('h3', {}, study.title), blurb);
    card.textContent = '';
    card.append(inner);
    card.addEventListener('click', () => {
      openCaseStudy(study, card);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCaseStudy(study, card);
      }
    });
    cards.append(card);
  }
  recent.append(cards);
  app.main.append(recent);

  if (!prefersReducedMotion()) {
    window.addEventListener('scroll', onScroll, { passive: true });
  }
  onScroll();
}

function onScroll(): void {
  const app = tryApp();
  if (!app) return;
  const vh = window.innerHeight;
  const scrolled = window.scrollY;
  const k = Math.max(0, Math.min(4, scrolled / vh));
  const nearest = Math.round(k);
  app.stage.setKeyframe(nearest);
}

function tryApp() {
  return (window as unknown as { __spindriftApp?: ReturnType<typeof getApp> }).__spindriftApp ?? null;
}

export function openCaseStudy(study: { title: string; blurb: string; keyframe: number }, opener: HTMLElement): void {
  const app = getApp();
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const sheet = el('div', { class: 'dialog case-sheet', role: 'dialog', 'aria-modal': 'true' });
  const heading = el('h2', {}, study.title);
  const para = el('p', {}, study.blurb);
  const close = el('button', { class: 'btn ghost' }, 'Close case study');
  sheet.append(heading, para, close);
  backdrop.append(sheet);
  document.body.append(backdrop);
  sheet.setAttribute('aria-label', study.title);
  sheet.querySelector('h2')?.setAttribute('aria-hidden', 'true');
  close.focus();
  const closeSheet = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    opener.focus();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
    }
    if (e.key === 'Tab') {
      const focusables = Array.from(sheet.querySelectorAll<HTMLElement>('button'));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  close.addEventListener('click', closeSheet);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSheet();
  });
}
