import { LONG, MEDIUM, SHORT, all, announce, api, one, play, reducedMotion } from './dom.js';
import { closeDialog, openDialog } from './dialogs.js';

const SLIM_BAR_AT = 200;
const PHONE_SHADOW_AT = 25;
const BACK_TO_TOP_AT = 600;
const RING_PLAYS = 3;

function startSlimBar(): void {
  const slim = one<HTMLElement>('[data-part="slim-bar"]');
  const phoneBar = one<HTMLElement>('[data-part="phone-bar"]');
  const backToTop = one<HTMLElement>('[data-part="back-to-top"]');
  let shown = false;
  const paint = (): void => {
    const past = window.scrollY;
    if (slim) {
      if (past >= SLIM_BAR_AT && !shown) {
        shown = true;
        slim.removeAttribute('hidden');
        play(slim, [{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], SHORT);
      } else if (past < SLIM_BAR_AT && shown) {
        shown = false;
        slim.setAttribute('hidden', '');
      }
    }
    phoneBar?.classList.toggle('scrolled', past >= PHONE_SHADOW_AT);
    if (backToTop) {
      if (past >= BACK_TO_TOP_AT) backToTop.removeAttribute('hidden');
      else backToTop.setAttribute('hidden', '');
    }
  };
  window.addEventListener('scroll', paint, { passive: true });
  paint();
}

function startRises(): void {
  const sections = all<HTMLElement>('.rise');
  if (sections.length === 0) return;
  if (reducedMotion()) {
    for (const section of sections) section.classList.add('risen');
    return;
  }
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const section = entry.target as HTMLElement;
      if (section.classList.contains('risen')) continue;
      section.classList.add('risen');
      play(section, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], LONG);
      watcher.unobserve(section);
    }
  });
  for (const section of sections) {
    const box = section.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0 && window.scrollY > 0) {
      section.classList.add('risen');
      continue;
    }
    watcher.observe(section);
  }
}

function startAccordions(): void {
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-accordion]');
    if (!button) return;
    const holder = button.closest<HTMLElement>('.accordion');
    const panel = holder ? one<HTMLElement>('.accordion-panel', holder) : null;
    if (!panel) return;
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    if (open) {
      panel.setAttribute('hidden', '');
      return;
    }
    panel.removeAttribute('hidden');
    play(panel, [{ opacity: 0 }, { opacity: 1 }], MEDIUM);
  });
  const fragment = window.location.hash.slice(1);
  if (fragment === '') return;
  const button = one<HTMLElement>(`[data-accordion="${fragment}"]`);
  if (!button) return;
  button.setAttribute('aria-expanded', 'true');
  one<HTMLElement>('.accordion-panel', button.closest('.accordion') as HTMLElement)?.removeAttribute('hidden');
}

function startClientMarks(): void {
  const strip = one<HTMLElement>('.marks-strip');
  if (!strip) return;
  let at = 0;
  const step = (direction: number): void => {
    const items = all<HTMLElement>('li', strip);
    const perView = window.innerWidth >= 1024 ? 5 : 2;
    const most = Math.max(0, items.length - perView);
    at = Math.min(most, Math.max(0, at + direction));
    play(strip, [{ transform: strip.style.transform || 'translateX(0)' }, { transform: `translateX(-${at * 170}px)` }], MEDIUM);
    strip.style.transform = `translateX(-${at * 170}px)`;
    const earlier = one<HTMLElement>('[data-marks="earlier"]');
    const later = one<HTMLElement>('[data-marks="later"]');
    earlier?.setAttribute('aria-disabled', String(at === 0));
    later?.setAttribute('aria-disabled', String(at === most));
  };
  for (const button of all<HTMLElement>('[data-marks]')) {
    button.addEventListener('click', () => {
      step(button.getAttribute('data-marks') === 'later' ? 1 : -1);
      button.focus();
    });
  }
  step(0);
}

function startMessageRing(): void {
  const ring = one<HTMLElement>('[data-part="message-us"]');
  if (!ring || reducedMotion()) return;
  const animation = ring.animate(
    [
      { boxShadow: '0 0 0 0 rgba(46, 230, 246, 0.9)' },
      { boxShadow: '0 0 0 18px rgba(46, 230, 246, 0)' },
    ],
    { duration: LONG, iterations: RING_PLAYS },
  );
  animation.finished.catch(() => undefined);
}

function startRail(): void {
  const rail = one<HTMLElement>('.on-this-page');
  if (!rail) return;
  const links = all<HTMLAnchorElement>('a', rail);
  const sections = links
    .map((link) => document.getElementById(link.getAttribute('href')?.slice(1) ?? ''))
    .filter((section): section is HTMLElement => section !== null);
  let held: string | null = null;
  const paint = (): void => {
    if (held) return;
    const atEnd = window.scrollY + window.innerHeight >= document.body.scrollHeight - 2;
    let current = sections[0]?.id ?? '';
    if (atEnd) {
      current = sections[sections.length - 1]?.id ?? current;
    } else {
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= 120) current = section.id;
      }
    }
    for (const link of links) {
      const mine = link.getAttribute('href') === `#${current}`;
      if (mine) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  };
  for (const link of links) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const id = link.getAttribute('href')?.slice(1) ?? '';
      const section = document.getElementById(id);
      section?.scrollIntoView({ behavior: 'auto', block: 'start' });
      held = id;
      for (const other of links) {
        if (other === link) other.setAttribute('aria-current', 'true');
        else other.removeAttribute('aria-current');
      }
      window.setTimeout(() => {
        held = null;
      }, 100);
    });
  }
  window.addEventListener('scroll', paint, { passive: true });
  paint();
}

function startSearch(): void {
  const input = one<HTMLInputElement>('#site-search');
  const results = one<HTMLElement>('.search-results');
  if (!input || !results) return;
  const run = async (): Promise<void> => {
    const q = input.value.trim();
    if (q === '') return;
    const answer = await api<{ results: { title: string; path: string; excerpt: string }[] }>(
      `/api/public/search?q=${encodeURIComponent(q)}`,
    );
    results.innerHTML = '';
    if (!answer.ok) {
      announce(answer.body.error.message);
      return;
    }
    if (answer.body.results.length === 0) {
      announce('Nothing found for that search.');
      return;
    }
    for (const result of answer.body.results) {
      const item = document.createElement('li');
      item.innerHTML = `<a href="${result.path}">${result.title}</a><p></p>`;
      const excerpt = one<HTMLElement>('p', item);
      if (excerpt) excerpt.textContent = result.excerpt;
      results.append(item);
    }
    announce(`${answer.body.results.length} results found.`);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void run();
    }
  });
}

export function startPublicSite(): void {
  startSlimBar();
  startRises();
  startAccordions();
  startClientMarks();
  startMessageRing();
  startRail();
  startSearch();
  window.addEventListener('pageshow', () => {
    window.dispatchEvent(new Event('scroll'));
  });
}

export { openDialog, closeDialog };
