import { el, on } from '../lib/dom.js';
import { COPY } from '../lib/copy.js';
import { navigate } from '../router.js';
import type { Screen } from '../router.js';
import { miniatureMap } from '../components/miniatureMap.js';
import { toolDrawings } from '../components/toolDrawings.js';

function pinnedWord(word: 'tramela' | 'estate'): HTMLElement {
  return el(
    'span',
    { class: `pinned-word pinned-${word}`, 'data-pin': word, 'aria-hidden': 'true' },
    word.toUpperCase(),
  );
}

export function landingScreen(): Screen {
  const signIn = el('a', { class: 'block-button sign-in-link', href: '/sign-in' }, 'Sign in');
  on(signIn, 'click', (event) => {
    event.preventDefault();
    void navigate('/sign-in');
  });

  const hero = el('section', { class: 'landing-hero' }, [
    el('div', { class: 'landing-white-panel' }, [
      el('h1', { class: 'landing-title' }, 'Tramela Estate'),
      el('p', { class: 'landing-support' }, COPY.landingSupport),
      signIn,
    ]),
    el('div', { class: 'landing-map-column' }, miniatureMap()),
  ]);

  const drawings = el('section', { class: 'landing-panel landing-drawings' }, [
    el('h2', {}, 'Every tin, drawn'),
    toolDrawings(),
  ]);

  const mapPanel = el('section', { class: 'landing-panel landing-map-panel' }, [
    el('h2', {}, 'The estate'),
    miniatureMap(),
  ]);

  const reading = el('section', { class: 'landing-panel landing-reading' }, [
    el('h2', {}, 'How it works'),
    el(
      'p',
      {},
      'Find the shop that holds what you need, reserve it on the shelf and pay at the counter when you collect.',
    ),
    el(
      'p',
      {},
      'Store managers run stock, till sales, collection hours and returns from one back office, each shop in its own local time.',
    ),
  ]);

  const node = el('div', { class: 'landing-screen' }, [
    pinnedWord('tramela'),
    pinnedWord('estate'),
    hero,
    drawings,
    mapPanel,
    reading,
  ]);

  return { node };
}
