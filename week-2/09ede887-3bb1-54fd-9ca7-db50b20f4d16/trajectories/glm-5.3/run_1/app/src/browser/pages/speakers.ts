/**
 * The speakers wall. Every speaker once, in order of first appearance, with
 * company, rendered bio and session links revealed on hover or focus.
 */

import * as api from '../api.js';
import { el } from '../dom.js';
import { state } from '../state.js';

export function speakerMonogram(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]!).join('').toUpperCase();
}

export async function renderSpeakers(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);
  main.append(el('p', { class: 'loading' }, 'Loading'));

  const [speakers, sessions] = await Promise.all([
    api.listSpeakers(),
    api.listSessions({ day: 'all', stage: 'all', format: 'all', q: '' }),
  ]);
  state.speakers = speakers;
  state.sessions = sessions;

  main.textContent = '';
  const banner = el('div', { class: 'speakers-banner' },
    el('h1', { class: 'speakers-title' }, 'Speakers'),
  );
  const wall = el('ul', { class: 'speaker-wall', role: 'list', 'aria-label': 'Speakers' });
  for (const speaker of speakers) {
    wall.append(buildTile(speaker, sessions));
  }
  main.append(banner, wall);
}

export function buildTile(speaker: api.Speaker, sessions: api.Session[]): HTMLElement {
  const tile = el('li', { class: 'speaker-tile', tabindex: '0' },
    el('span', { class: 'speaker-monogram', 'aria-hidden': 'true' }, speakerMonogram(speaker.name)),
    el('div', { class: 'speaker-body' },
      el('h2', { class: 'speaker-name' }, speaker.name),
      el('p', { class: 'speaker-company' }, speaker.company),
      el('div', { class: 'speaker-bio', html: speaker.bio_html }),
      el('ul', { class: 'speaker-sessions', role: 'list' },
        ...speaker.sessions.map((id) =>
          el('li', {},
            el('a', { href: `/sessions/${id}` }, sessions.find((s) => s.id === id)?.title ?? id)),
        ),
      ),
    ),
  );
  // Pointing at a tile, or focusing it, reveals its sessions; Escape hides them.
  tile.addEventListener('focus', () => {
    tile.classList.add('is-open');
  });
  tile.addEventListener('mouseenter', () => {
    tile.classList.add('is-open');
  });
  tile.addEventListener('mouseleave', () => {
    tile.classList.remove('is-open');
  });
  tile.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      tile.classList.remove('is-open');
    }
  });
  return tile;
}
