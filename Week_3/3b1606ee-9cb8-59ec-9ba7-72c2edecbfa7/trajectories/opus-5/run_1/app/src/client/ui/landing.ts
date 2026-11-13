import { diamond, el, monogram, sheet } from './dom.js';

const HERO_LINES = ['No phone number', 'No email', 'Sealed in your browser'];

function heroPostmark(): HTMLElement {
  return el('p', { class: 'hero-postmark', text: "Halfpenny Post · held until you're back" });
}

function backFlap(): HTMLElement {
  return el('footer', { class: 'back-flap' }, [
    el('p', { class: 'return-address', text: 'Halfpenny Post Co.' }),
    el('p', { class: 'return-address', text: '14 Tidewater Row' }),
    el('p', { class: 'return-address', text: 'Larkmouth LM4 2QS' }),
  ]);
}

export function landingScreen(): HTMLElement {
  const { outer, inner } = sheet({ class: 'hero-sheet' });

  const heading = el('h1', { class: 'hero-heading' }, [
    el('span', { class: 'hero-line-one', text: 'Letters that seal' }),
    ' ',
    el('span', { class: 'hero-line-two', text: 'themselves' }),
  ]);

  const lines = el('p', { class: 'hero-lines' });
  HERO_LINES.forEach((line, index) => {
    if (index > 0) lines.append(diamond());
    lines.append(el('span', { class: 'hero-line', text: line }));
  });

  inner.append(heroPostmark(), el('div', { class: 'hero-centre' }, [heading, lines]));

  const topBar = el('div', { class: 'landing-bar' }, [
    monogram(),
    el('nav', { class: 'landing-links', attrs: { 'aria-label': 'Landing' } }, [
      el('a', { text: 'How sealing works', attrs: { href: '#how-sealing-works' } }),
      el('a', { text: 'Seal numbers', attrs: { href: '#seal-numbers' } }),
      el('a', { text: 'Sign in', attrs: { href: '/signin' } }),
    ]),
    el('a', {
      class: 'ink-button',
      text: 'Choose a username',
      attrs: { href: '/signup' },
    }),
  ]);

  const sections = el('div', { class: 'landing-sections' }, [
    el('section', { class: 'landing-section', attrs: { id: 'how-sealing-works' } }, [
      el('h2', { text: 'How sealing works' }),
      el('p', {
        text:
          'Your identity key is made in this page and never leaves it. Every letter, photo, ' +
          'file, display name and file name is sealed here before it goes to the exchange, ' +
          'which holds it only until the person you wrote to collects it.',
      }),
    ]),
    el('section', { class: 'landing-section', attrs: { id: 'seal-numbers' } }, [
      el('h2', { text: 'Seal numbers' }),
      el('p', {
        text:
          'Each pair of correspondents shares a 60-digit seal number in 12 groups of five. ' +
          'Compare it in person and mark the contact verified. If their key ever changes, ' +
          'letters pause until you accept the new seal number.',
      }),
    ]),
  ]);

  return el('div', { class: 'landing' }, [topBar, outer, sections, backFlap()]);
}
