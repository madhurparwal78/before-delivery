import { api, type SessionView, type SpeakerView, type Stage } from '../api.js';
import { INTRO_COPY, RECORD_COPY, SPONSORS, STATEMENT_FOLLOW_ON, STATEMENT_ROWS } from '../copy.js';
import { el, prefersReducedMotion } from '../dom.js';
import type { Page } from '../router.js';
import { startHeroDrift, startStagger } from '../motion.js';

const ECHO_COUNT = 4;

function hero(): HTMLElement {
  const photo = el('div', { class: 'hero-photo' }, [
    el('img', {
      class: 'hero-image',
      src: '/assets/star-trails-1920.jpg',
      srcset: '/assets/star-trails-960.jpg 960w, /assets/star-trails-1920.jpg 1920w',
      sizes: '100vw',
      alt: '',
      'aria-hidden': 'true',
    }),
    el('canvas', { class: 'hero-grain', 'aria-hidden': 'true' }),
  ]);
  return el('section', { class: 'hero', id: 'overview' }, [
    photo,
    el('div', { class: 'hero-words' }, [
      el('h1', { class: 'hero-wordmark', 'aria-label': 'Keel Outpost 2026' }, [
        el('span', { class: 'cutout cutout-line', text: 'Keel Outpost' }),
        el('span', { class: 'hero-second-line' }, [
          el('span', { class: 'cutout cutout-line', text: '2026' }),
          el('span', { class: 'hero-side' }, [
            el('span', { class: 'hero-venue', text: 'Harbour Quay Hall, Port Ashby' }),
            el('span', { class: 'hero-partner', text: 'with LEDGERWEEK' }),
          ]),
        ]),
        el('span', { class: 'cutout hero-dates', text: 'October 31 - November 1' }),
      ]),
    ]),
    el('div', { class: 'hero-foot' }, [el('span', { text: 'Sponsored by →' }), ...SPONSORS.map((name) => el('span', { class: 'sponsor-word', text: name }))]),
  ]);
}

function statement(): HTMLElement {
  const reduced = prefersReducedMotion();
  const rows = STATEMENT_ROWS.map((line, index) => {
    const row = el('span', { class: 'statement-row', 'data-row': String(index) });
    if (!reduced) {
      for (let echo = 0; echo < ECHO_COUNT; echo += 1) {
        // The echo text is drawn by a pseudo-element: pure decoration that
        // duplicates the row beneath it, so it is not a text node at all.
        row.appendChild(
          el('span', { class: 'statement-echo', 'aria-hidden': 'true', 'data-echo': String(echo), 'data-text': line }),
        );
      }
    }
    row.appendChild(el('span', { class: 'statement-main', text: line }));
    return row;
  });
  return el('section', { class: `statement${reduced ? ' is-static' : ''}` }, [
    el('h2', { class: 'statement-heading', 'aria-label': "The next $5 trillion in transactions won't be human." }, rows),
    el('p', { class: 'statement-follow', text: STATEMENT_FOLLOW_ON }),
  ]);
}

function experiences(stages: readonly Stage[]): HTMLElement {
  return el('section', { class: 'experiences', id: 'experiences' }, [
    el('h2', { text: 'Experiences' }),
    el(
      'div',
      { class: 'experience-strip' },
      stages.map((stage) =>
        el('a', { class: 'experience-card', href: `/agenda?stage=${encodeURIComponent(stage.slug)}` }, [
          el('span', { class: 'experience-name', text: stage.name }),
          el('span', { class: 'experience-description', text: stage.description }),
        ]),
      ),
    ),
  ]);
}

function recordTeaser(): HTMLElement {
  return el('section', { class: 'record-teaser', id: 'tps-record' }, [
    el('span', { class: 'accent-rule', 'aria-hidden': 'true' }),
    el('div', {}, [
      el('p', { class: 'teaser-headline', text: RECORD_COPY.headline }),
      el('p', { text: RECORD_COPY.body }),
      el('p', {}, [el('a', { class: 'teaser-link', href: '/record', text: 'Call the number' })]),
    ]),
  ]);
}

function agendaChapter(): HTMLElement {
  return el('section', { class: 'home-agenda', id: 'agenda' }, [
    el('h2', { text: 'Agenda' }),
    el('p', { class: 'helper-line', text: 'Two days, four stages, eighteen sessions.' }),
    el('div', { class: 'home-agenda-links' }, [
      el('a', { class: 'button button-primary', href: '/agenda', text: 'See the full agenda' }),
      el('a', { class: 'button', href: '/signup', text: 'Sign up to reserve' }),
    ]),
  ]);
}

function speakerTiles(speakers: readonly SpeakerView[]): HTMLElement {
  return el('section', { class: 'home-speakers', id: 'speakers' }, [
    el('h2', { text: 'Speakers' }),
    el(
      'ul',
      { class: 'speaker-wall speaker-wall-home' },
      speakers.slice(0, 8).map((speaker) =>
        el('li', { class: 'speaker-tile' }, [
          el('span', { class: 'monogram', 'aria-hidden': 'true', text: initials(speaker.name) }),
          el('div', { class: 'speaker-detail' }, [
            el('p', { class: 'speaker-name', text: speaker.name }),
            el('p', { class: 'speaker-company', text: speaker.company }),
          ]),
        ]),
      ),
    ),
    el('p', {}, [el('a', { href: '/speakers', text: 'All speakers' })]),
  ]);
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return `${words[0]?.[0] ?? ''}${words.length > 1 ? words[words.length - 1]?.[0] ?? '' : ''}`.toUpperCase();
}

function sponsors(): HTMLElement {
  return el('section', { class: 'sponsors', id: 'sponsors' }, [
    el('h2', { text: 'Sponsors' }),
    el('ul', { class: 'sponsor-list' }, SPONSORS.map((name) => el('li', { text: name }))),
  ]);
}

export function homePage(): Page {
  const element = el('main', { class: 'page page-home', id: 'main' });
  let stopStagger: (() => void) | null = null;
  let stopHero: (() => void) | null = null;

  return {
    element,
    mount: () => {
      element.appendChild(el('p', { class: 'loading', text: 'Loading' }));
      void (async () => {
        let stages: Stage[] = [];
        let speakers: SpeakerView[] = [];
        let sessions: SessionView[] = [];
        try {
          [stages, speakers, sessions] = await Promise.all([
            api.stages(),
            api.speakers(),
            api.sessions('?day=all&stage=all&format=all'),
          ]);
        } catch {
          stages = [];
        }
        const statementSection = statement();
        element.replaceChildren(
          hero(),
          el('section', { class: 'intro' }, [el('p', { text: INTRO_COPY })]),
          statementSection,
          experiences(stages),
          recordTeaser(),
          agendaChapter(),
          speakerTiles(speakers),
          sponsors(),
        );
        element.querySelector('.helper-line')?.replaceChildren(
          document.createTextNode(`Two days, four stages, ${sessions.length} sessions.`),
        );
        stopStagger = startStagger(statementSection);
        const heroSection = element.querySelector<HTMLElement>('.hero');
        if (heroSection !== null) stopHero = startHeroDrift(heroSection);
        scrollToHash();
      })();
    },
    unmount: () => {
      stopStagger?.();
      stopHero?.();
    },
  };
}

function scrollToHash(): void {
  if (location.hash === '') return;
  const target = document.querySelector(location.hash);
  if (target === null) return;
  requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
}
