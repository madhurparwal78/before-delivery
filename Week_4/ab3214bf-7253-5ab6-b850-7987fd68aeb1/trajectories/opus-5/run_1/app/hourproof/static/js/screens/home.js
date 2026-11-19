// The public poster.

import { el } from '../dom.js';
import { discMeter } from '../drawings.js';
import { marquee } from '../marquee.js';
import { linkTo } from '../router.js';

export function mount({ container }) {
  const headline = el('h1', { className: 'hero__headline', 'aria-label': 'EVERY HOUR' });
  headline.append(el('span', { text: 'EVERY' }), el('br'), el('span', { text: 'HOUR' }));
  const cta = linkTo('/sign-in', 'OPEN THE DESK');
  cta.className = 'button hero__cta';
  const hero = el('section', { className: 'hero' }, [
    el('span', { className: 'hero__mark', text: 'Hourproof' }),
    discMeter('hero__meter'),
    el('div', { className: 'hero__copy' }, [
      headline,
      el('p', {
        className: 'hero__sentence',
        text: 'A year of clean power means nothing at 3am.',
      }),
    ]),
    cta,
  ]);
  container.append(marquee(), hero);
  return {};
}
