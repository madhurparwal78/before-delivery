import { boundingBox, layoutMap } from '../../shared/layout.js';
import { colourHex, derivedColour } from '../../shared/style.js';
import { visibleTopics } from '../../shared/tree.js';
import { animate, el, on, reducedMotion, svg } from '../dom.js';
import { renderMiniature, sampleDoc } from '../miniature.js';
import { resetScreen } from '../shell.js';

const HERO = sampleDoc('Village harvest show', [
  { title: 'Produce tent' },
  { title: 'Judging panel' },
  { title: 'Children\u2019s corner' },
  { title: 'Cake stall' },
  { title: 'Tombola' },
  { title: 'Parking and signs' },
  { title: 'Clean-up rota' },
  { title: 'Thank-you notes' },
]);

interface FeatureBlock {
  heading: string;
  paragraph: string;
  checklist: [string, string, string];
  sample: ReturnType<typeof sampleDoc>;
}

const BLOCKS: FeatureBlock[] = [
  {
    heading: 'One idea in the middle, branches all around',
    paragraph:
      'Start from a central idea and press Tab. Sprigmap grows the branches, balances the sides and publishes every coordinate, so the map looks the same on every screen.',
    checklist: [
      'Build a whole map from the keyboard',
      'Mind map, org chart and list of the same tree',
      'Branches regrow in place when you switch',
    ],
    sample: sampleDoc('Study plan', [
      { title: 'Cell biology', children: [{ title: 'Membranes' }, { title: 'Mitosis' }] },
      { title: 'Revision timetable' },
      { title: 'Past papers' },
    ]),
  },
  {
    heading: 'Edit together without losing a word',
    paragraph:
      'Two people can drag the same branch, rename the same topic or delete under each other. One published rule decides every conflict, and the person who lost it is told.',
    checklist: [
      'Titles merge by character offset',
      'Lost text waits in Recovered edits',
      'Undo reverses only your own work',
    ],
    sample: sampleDoc('Novel plot', [
      { title: 'Act one', children: [{ title: 'The letter' }] },
      { title: 'Act two' },
      { title: 'Act three' },
    ]),
  },
  {
    heading: 'Keep working on the train',
    paragraph:
      'Turn on Work offline and keep typing. Your changes queue in the browser, survive a reload and replay in order the moment you are back, with a count of what met a conflict.',
    checklist: [
      'Queued changes survive a reload',
      'Each change replays exactly once',
      'You hear what was sent and what clashed',
    ],
    sample: sampleDoc('House move', [
      { title: 'Boxes' },
      { title: 'Utilities' },
      { title: 'Moving day', children: [{ title: 'Van' }] },
    ]),
  },
  {
    heading: 'Show the map, then hand it over',
    paragraph:
      'Present the map as a slide show that an audience follows from a link, restore any version, and keep every map in a plain-text outline you can read without us.',
    checklist: [
      'Replay, compare and restore versions',
      'An audience follows from a phone',
      'Exports are plain text or standalone SVG',
    ],
    sample: sampleDoc('Street fair', [
      { title: 'Stalls' },
      { title: 'Music stage' },
      { title: 'Volunteers and rotas' },
      { title: 'Budget' },
    ]),
  },
];

function topBar(): HTMLElement {
  const bar = el('header', { class: 'top-bar', role: 'banner' }, [
    el('a', { href: '/', class: 'logo', 'aria-label': 'Sprigmap' }, [
      el('span', { class: 'logo-mark', 'aria-hidden': 'true' }),
      el('span', { text: 'Sprigmap' }),
    ]),
    el('nav', { class: 'top-bar-links' }, [
      el('a', { href: '/signin', text: 'Sign in' }),
      el('a', { href: '/signup', class: 'button-link', text: 'Get started' }),
    ]),
  ]);
  const onScroll = (): void => {
    bar.classList.toggle('compact', window.scrollY > 8);
  };
  on(window, 'scroll', onScroll, { passive: true });
  onScroll();
  return bar;
}

function ribbonField(): HTMLElement {
  const view = { doc: HERO, collapsed: new Set<string>(), hidden: new Set<string>() };
  const layout = layoutMap(view, 'map');
  const bounds = boundingBox(layout) ?? { x: -600, y: -300, w: 1200, h: 600 };
  const pad = 80;
  const picture = svg('svg', {
    class: 'ribbons',
    viewBox: `${Math.round(bounds.x - pad)} ${Math.round(bounds.y - pad)} ${Math.round(bounds.w + pad * 2)} ${Math.round(bounds.h + pad * 2)}`,
    'aria-hidden': 'true',
    focusable: 'false',
    preserveAspectRatio: 'xMidYMid slice',
  });
  const ribbons: SVGElement[] = [];
  for (const id of visibleTopics(view)) {
    const topic = HERO.topics[id];
    if (topic.parent_id === null) continue;
    const box = layout.get(id);
    const parent = layout.get(topic.parent_id);
    if (!box || !parent) continue;
    const edge = box.x > 0 ? bounds.x + bounds.w + pad : bounds.x - pad;
    const path = svg('path', {
      d: `M ${edge} ${box.y} C ${box.x} ${box.y}, ${(box.x + parent.x) / 2} ${box.y}, ${parent.x} ${parent.y}`,
      fill: 'none',
      stroke: colourHex(derivedColour(HERO, id)),
      'stroke-width': 26,
      'stroke-linecap': 'round',
      class: 'ribbon',
    });
    ribbons.push(path);
    picture.append(path);
  }
  const avatars = ['AS', 'BE', 'CH'];
  avatars.forEach((initials, index) => {
    const box = layout.get(HERO.topics[HERO.root].children[index]);
    if (!box) return;
    const group = svg('g', { class: 'hero-avatar' }, [
      svg('circle', { cx: box.x, cy: box.y, r: 26, fill: '#ffffff', stroke: '#d8d6e6', 'stroke-width': 3 }),
      svg('text', {
        x: box.x,
        y: box.y + 6,
        'text-anchor': 'middle',
        'font-size': 18,
        'font-family': 'Figtree, sans-serif',
        fill: '#2c2740',
      }),
    ]);
    const label = group.lastElementChild;
    if (label) label.textContent = initials;
    picture.append(group);
  });

  const stack = el('div', { class: 'hero-stack' }, [
    el('p', { class: 'eyebrow', text: 'Mind maps for the people who plan together' }),
    el('h1', {}, [
      el('span', { text: 'Grow one idea' }),
      el('span', { text: 'into a shared map' }),
    ]),
    el('div', { class: 'hero-arrow', 'aria-hidden': 'true' }, [
      svg('svg', { viewBox: '0 0 120 60', focusable: 'false' }, [
        svg('path', {
          d: 'M 6 8 C 40 10, 70 24, 96 46',
          fill: 'none',
          stroke: '#1f49e0',
          'stroke-width': 3,
          'stroke-linecap': 'round',
          class: 'arrow-line',
        }),
        svg('path', {
          d: 'M 84 42 L 98 48 L 86 56',
          fill: 'none',
          stroke: '#1f49e0',
          'stroke-width': 3,
          'stroke-linecap': 'round',
        }),
      ]),
    ]),
    el('div', { class: 'hero-actions' }, [
      el('a', { href: '/signup', class: 'primary-link', text: 'Start a map' }),
    ]),
  ]);

  const field = el('section', { class: 'hero' }, [picture, stack]);
  if (!reducedMotion()) {
    ribbons.forEach((ribbon, index) => {
      animate(ribbon, 'ribbon-draw', [{ opacity: 0 }, { opacity: 1 }], 240, index * 150);
    });
    const avatars = [...picture.querySelectorAll('.hero-avatar')];
    avatars.forEach((avatar, index) => {
      animate(
        avatar,
        'avatar-pop',
        [{ transform: 'scale(0.6)' }, { transform: 'scale(1)' }],
        180,
        1200 + index * 90,
      );
    });
    const arrow = stack.querySelector('.arrow-line');
    if (arrow) animate(arrow, 'arrow-draw', [{ opacity: 0 }, { opacity: 1 }], 220, 1460);
  }
  return field;
}

function featureBlock(block: FeatureBlock, index: number): HTMLElement {
  const text = el('div', { class: 'feature-text' }, [
    el('h2', { text: block.heading }),
    el('p', { text: block.paragraph }),
    el(
      'ul',
      { class: 'checklist' },
      block.checklist.map((item) =>
        el('li', {}, [el('span', { class: 'tick', 'aria-hidden': 'true' }), el('span', { text: item })]),
      ),
    ),
  ]);
  const panel = el('div', { class: 'feature-panel' }, [renderMiniature(block.sample)]);
  return el('section', { class: `feature ${index % 2 === 0 ? 'text-first' : 'panel-first'}` }, [
    text,
    panel,
  ]);
}

function footer(): HTMLElement {
  const columns: [string, string[]][] = [
    ['Sprigmap', ['Grow a map', 'Edit together', 'Present live']],
    ['Working', ['Offline queue', 'Version history', 'Sprig outline format']],
    ['Sharing', ['Roles and locks', 'Expiring links', 'Restricted branches']],
  ];
  return el(
    'footer',
    { class: 'site-footer' },
    columns.map(([heading, items]) => {
      const list = el(
        'ul',
        {},
        items.map((item) => el('li', { text: item })),
      );
      const button = el('button', {
        type: 'button',
        class: 'footer-heading',
        'aria-expanded': 'false',
        text: heading,
      });
      const column = el('div', { class: 'footer-column' }, [button, list]);
      on(button, 'click', () => {
        const open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', open ? 'false' : 'true');
        column.classList.toggle('open', !open);
      });
      return column;
    }),
  );
}

export function homeScreen(): void {
  const root = resetScreen();
  document.title = 'Sprigmap';
  root.append(
    topBar(),
    el('main', {}, [
      ribbonField(),
      el('p', { class: 'product-statement' }, [
        el('span', {
          text: 'Sprigmap grows one central idea into a map you edit live with a few other people,',
        }),
        el('span', {
          text: 'keep working on offline, present from a link and keep as plain text for good.',
        }),
      ]),
      ...BLOCKS.map((block, index) => featureBlock(block, index)),
    ]),
    footer(),
  );
}
