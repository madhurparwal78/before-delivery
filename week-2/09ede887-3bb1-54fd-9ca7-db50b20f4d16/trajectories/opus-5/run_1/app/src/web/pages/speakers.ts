import { api, type SpeakerView } from '../api.js';
import { el, markup } from '../dom.js';
import type { Page } from '../router.js';
import { rememberTitles, titleOf } from '../titles.js';

function monogram(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]?.[0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

function tile(speaker: SpeakerView): HTMLLIElement {
  const sessionLinks = el(
    'ul',
    { class: 'speaker-sessions' },
    speaker.sessions.map((sessionId) =>
      el('li', {}, [el('a', { href: `/sessions/${sessionId}`, text: titleOf(sessionId) ?? sessionId })]),
    ),
  );
  const item = el('li', { class: 'speaker-tile', tabindex: '0' }, [
    el('span', { class: 'monogram', 'aria-hidden': 'true', text: monogram(speaker.name) }),
    el('div', { class: 'speaker-detail' }, [
      el('p', { class: 'speaker-name', text: speaker.name }),
      el('p', { class: 'speaker-company', text: speaker.company }),
      speaker.bio_html === '' ? null : markup('p', 'speaker-bio', speaker.bio_html),
      sessionLinks,
    ]),
  ]);
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') item.classList.remove('is-open');
  });
  item.addEventListener('focusin', () => item.classList.add('is-open'));
  item.addEventListener('focusout', (event) => {
    if (!item.contains(event.relatedTarget as Node | null)) item.classList.remove('is-open');
  });
  return item;
}

export function speakersPage(): Page {
  const element = el('main', { class: 'page page-speakers', id: 'main' });
  return {
    element,
    mount: () => {
      element.appendChild(el('p', { class: 'loading', text: 'Loading' }));
      void (async () => {
        let speakers: SpeakerView[] = [];
        try {
          rememberTitles(await api.sessions('?day=all&stage=all&format=all'));
          speakers = await api.speakers();
        } catch {
          speakers = [];
        }
        element.replaceChildren(
          el('div', { class: 'speakers-banner' }, [el('h1', {}, [el('span', { class: 'cutout', text: 'Speakers' })])]),
          el('ul', { class: 'speaker-wall', 'aria-label': 'Speakers' }, speakers.map(tile)),
        );
      })();
    },
  };
}
