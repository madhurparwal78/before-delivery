import { clear, h } from '../dom.js';
import { plate } from '../plates.js';
import { navigate, type RouteContext } from '../router.js';
import { mainRegion } from '../shell.js';
import { serverToday } from '../state.js';
import { searchForm } from '../components/searchform.js';

const PASSAGES: Array<{ leg: string; kind: 'road' | 'fields' | 'ferry'; text: string }> = [
  {
    leg: 'Kestrevel to Tollemarch',
    kind: 'road',
    text: 'Three hours of road, four stops, and a price that follows the distance rather than the driver\u2019s mood.',
  },
  {
    leg: 'Brisanne to Oakhythe',
    kind: 'fields',
    text: 'Join at a stopover and pay for the stretch you travel. The server works out the share before you press Book.',
  },
  {
    leg: 'Tollemarch to Corrandy',
    kind: 'ferry',
    text: 'Every hold, expiry and refund is decided once, in one place, and shown the same way on both sides.',
  },
];

export function renderHome(_ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);

  const heading = h(
    'h1',
    { class: 'hero-heading' },
    h('span', { class: 'hero-line-one', text: 'Empty seats,' }),
    ' ',
    h('span', { class: 'hero-line-two', text: 'long roads.' }),
  );

  const hero = h(
    'section',
    { class: 'hero' },
    heading,
    h('p', {
      class: 'hero-note',
      text: 'Share the drive between eight towns, at the price the distance sets.',
    }),
    h(
      'a',
      { href: '/search', class: 'split-action', 'aria-label': 'Find a seat' },
      h('span', { class: 'split-label', text: 'Find a seat' }),
      h('span', { class: 'split-arrow', 'aria-hidden': 'true', text: '\u2192' }),
    ),
    plate({
      seed: 'hero-coast',
      leg: 'Kestrevel to Hesketh Mere',
      kind: 'coast',
      ratio: 1.6,
      className: 'hero-plate-wide',
    }),
    plate({
      seed: 'hero-interior',
      leg: 'Vardholm to Kestrevel',
      kind: 'interior',
      ratio: 0.8,
      className: 'hero-plate-tall',
    }),
  );

  const form = searchForm({
    initial: { from: 'Kestrevel', to: 'Tollemarch', date: serverToday(), seats: 1 },
    withSearchButton: true,
    onSubmit: (state) => {
      const query = new URLSearchParams({
        from: state.from,
        to: state.to,
        date: state.date,
        seats: String(state.seats),
      });
      navigate(`/search?${query.toString()}`);
    },
  });

  const passages = h('section', { class: 'passages' });
  PASSAGES.forEach((passage, index) => {
    passages.appendChild(
      h(
        'div',
        { class: `passage passage-${index + 1}` },
        plate({
          seed: `home-${passage.leg}`,
          leg: passage.leg,
          kind: passage.kind,
          ratio: index === 1 ? 1.9 : 1.5,
        }),
        h('p', { class: 'passage-text', text: passage.text }),
      ),
    );
  });

  main.append(hero, h('section', { class: 'home-search' }, form.element), passages);
}
