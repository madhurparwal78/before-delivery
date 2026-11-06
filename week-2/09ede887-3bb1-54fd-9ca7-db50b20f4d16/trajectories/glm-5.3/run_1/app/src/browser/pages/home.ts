/**
 * The event home page: hero, intro, the stagger statement, Experiences, the
 * record teaser, the agenda chapter, the first speaker tiles and sponsors.
 */

import * as api from '../api.js';
import { el } from '../dom.js';
import { state } from '../state.js';
import { speakerMonogram } from './speakers.js';

export async function renderHome(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);
  main.append(el('p', { class: 'loading' }, 'Loading'));

  const [stages, speakers] = await Promise.all([
    api.listStages(),
    api.listSpeakers().catch(() => []),
  ]);
  state.stages = stages;

  main.textContent = '';
  main.append(buildHero());
  main.append(
    el('section', { id: 'overview', class: 'chapter' },
      el('p', { class: 'intro' },
        'Join us in Port Ashby for Keel Outpost 2026 at Harbour Quay Hall, with LEDGERWEEK. One vision: money that moves as freely as messages. This is where the global Keel community - founders, builders, developers, investors, traders - gathers to shape what comes next.'),
    ),
  );
  main.append(buildStaggerStatement());
  main.append(
    el('p', { class: 'statement-follow' },
      'Agentic finance needs the right rails. Instant settlement. Autonomous payments. Private transactions.'),
  );
  main.append(buildExperiences(stages));
  main.append(
    el('section', { id: 'tps-record', class: 'chapter chapter-alt' },
      el('div', { class: 'teaser' },
        el('a', { href: '/record', class: 'teaser-link' }, 'Call the number'),
        el('p', { class: 'teaser-copy' },
          "Live at Keel Outpost, we're going after our own record. Closest guess to the final figure takes first place."),
      ),
    ),
  );
  main.append(
    el('section', { id: 'agenda-chapter', class: 'chapter' },
      el('h2', { class: 'section-title' }, 'Agenda'),
      el('p', { class: 'chapter-copy' }, 'Two days of talks, workshops and games across four stages.'),
      el('p', { class: 'chapter-links' },
        el('a', { href: '/agenda', class: 'link-blue' }, 'See the full agenda'),
        ' ',
        el('a', { href: '/signup', class: 'link-outline' }, 'Sign up to reserve'),
      ),
    ),
  );
  main.append(buildSpeakerPreview(speakers.slice(0, 8)));
  main.append(
    el('section', { id: 'sponsors', class: 'chapter chapter-dark' },
      el('h2', { class: 'section-title' }, 'Sponsors'),
      el('p', { class: 'sponsors-line' },
        'LEDGERWEEK · Northgate Press · Quayside · Lantern · Reedwork · Harbor Group'),
    ),
  );
  bindStaggerEffect();
  bindHeroDrift();
}

/** The hero photograph drifts upward more slowly than the page and is fully
 * darkened by the time the hero has scrolled out. With reduced motion it stays
 * still and undimmed. */
function bindHeroDrift(): void {
  const hero = document.querySelector('.hero');
  const photo = document.querySelector('.hero-photo');
  if (hero === null || photo === null) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const update = (): void => {
    const height = (hero as HTMLElement).offsetHeight;
    const scrolled = Math.min(height, Math.max(0, window.scrollY));
    const progress = height === 0 ? 0 : scrolled / height;
    (photo as HTMLElement).style.transform = `translateY(${-progress * height * 0.18}px)`;
    (photo as HTMLElement).style.filter = `brightness(${1 - progress * 0.85})`;
  };
  window.addEventListener('scroll', () => {
    update();
  }, { passive: true });
  update();
}

function buildHero(): HTMLElement {
  const hero = el('section', { class: 'hero' });
  const photo = el('div', { class: 'hero-photo' },
    el('img', {
      src: '/assets/img/star-trails-1280.jpg',
      srcset:
        '/assets/img/star-trails-640.jpg 640w, /assets/img/star-trails-1280.jpg 1280w, /assets/img/star-trails-1920.jpg 1920w',
      sizes: '100vw',
      alt: '',
    }),
  );
  const wordmark = el('div', { class: 'hero-wordmark' },
    el('h1', { class: 'wordmark-line', 'aria-label': 'Keel Outpost 2026' }, 'Keel Outpost'),
    el('div', { class: 'wordmark-row' },
      el('span', { class: 'wordmark-year' }, '2026'),
      el('div', { class: 'wordmark-side' },
        el('p', { class: 'wordmark-venue' }, 'Harbour Quay Hall, Port Ashby'),
        el('p', { class: 'wordmark-partner' }, 'with LEDGERWEEK'),
      ),
    ),
    el('div', { class: 'wordmark-tab' }, 'October 31 - November 1'),
  );
  const strip = el('div', { class: 'hero-strip' },
    'Sponsored by → LEDGERWEEK · Northgate Press · Quayside');
  hero.append(photo, wordmark, strip);
  hero.append(el('div', { class: 'hero-grain', 'aria-hidden': 'true' }));
  return hero;
}

function buildStaggerStatement(): HTMLElement {
  const rows = ['The next', '$5 trillion', 'in transactions', "won't be", 'human.'];
  const box = el('section', { class: 'stagger' });
  const heading = el('h2', { class: 'stagger-heading' },
    "The next $5 trillion in transactions won't be human.");
  const lines = el('div', { class: 'stagger-lines', 'aria-hidden': 'true' });
  for (const row of rows) {
    const line = el('div', { class: 'stagger-row' });
    for (let i = 0; i < 5; i++) line.append(el('span', { class: 'stagger-echo' }, row));
    lines.append(line);
  }
  box.append(heading, lines);
  return box;
}

function buildExperiences(stages: api.Stage[]): HTMLElement {
  const cards = el('section', { id: 'experiences', class: 'chapter experiences' },
    el('h2', { class: 'section-title' }, 'Experiences'),
  );
  const row = el('div', { class: 'experience-cards' });
  for (const stage of stages) {
    row.append(
      el('a', { href: `/agenda?stage=${stage.slug}`, class: 'experience-card', 'aria-label': stage.name },
        el('h3', { class: 'experience-name' }, stage.name),
        el('p', { class: 'experience-copy' }, stage.description),
      ),
    );
  }
  cards.append(row);
  return cards;
}

function buildSpeakerPreview(speakers: api.Speaker[]): HTMLElement {
  const section = el('section', { id: 'speakers-chapter', class: 'chapter' },
    el('h2', { class: 'section-title' }, 'Speakers'),
  );
  const wall = el('ul', { class: 'speaker-wall speaker-wall-preview', role: 'list', 'aria-label': 'Speakers' });
  for (const speaker of speakers) {
    wall.append(
      el('li', { class: 'speaker-tile' },
        el('span', { class: 'speaker-monogram', 'aria-hidden': 'true' }, speakerMonogram(speaker.name)),
        el('div', { class: 'speaker-body' },
          el('h3', { class: 'speaker-name' }, speaker.name),
          el('p', { class: 'speaker-company' }, speaker.company),
        ),
      ),
    );
  }
  section.append(wall);
  section.append(el('p', { class: 'chapter-links' },
    el('a', { href: '/speakers', class: 'link-blue' }, 'See all speakers')));
  return section;
}

/**
 * The scroll-following stagger effect. The echoes spread out and fade in as the
 * statement rises; with reduced motion they are not drawn at all.
 */
function bindStaggerEffect(): void {
  const lines = document.querySelector('.stagger-lines');
  if (lines === null) return;
  const rows = Array.from(lines.querySelectorAll('.stagger-row'));
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    lines.classList.add('stagger-static');
    return;
  }
  const echoes = rows.map((row) => Array.from(row.querySelectorAll<HTMLElement>('.stagger-echo')));
  const update = (): void => {
    const box = lines.getBoundingClientRect();
    const windowH = window.innerHeight;
    const start = windowH;
    const end = windowH / 2 - box.height / 2;
    const raw = (start - box.top) / Math.max(1, start - end);
    const progress = Math.min(1, Math.max(0, raw));
    rows.forEach((_row, index) => {
      const rowProgress = Math.min(1, Math.max(0, progress * 1.6 - index * 0.12));
      const spread = (1 - rowProgress) * 50;
      (echoes[index] as HTMLElement[]).forEach((echo, echoIndex) => {
        const mid = 2;
        if (echoIndex === mid) {
          echo.style.transform = 'translateX(0)';
          echo.style.opacity = String(Math.min(1, rowProgress * 2));
        } else {
          const side = echoIndex < mid ? -1 : 1;
          const distance = Math.abs(echoIndex - mid);
          echo.style.transform = `translateX(${side * spread * distance * 0.6}%)`;
          echo.style.opacity = String((1 - rowProgress) * 0.25);
        }
      });
    });
  };
  window.addEventListener('scroll', () => {
    update();
  }, { passive: true });
  update();
}
