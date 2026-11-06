import { el, formatCents, svgIcon } from '../dom.js';
import { loadCatalog } from '../store.js';
import { disclosure, reducedMotion, sectionReveal } from '../ui.js';
import type { BoardPackageItem } from '../types.js';

const BOARD_COPY = [
  {
    board: 'Drift',
    eyebrow: 'First flights',
    description: 'A forgiving deck and a broad wing for your very first lift-off.',
    material: 'Glass-wrapped EPS core',
    battery: '1.8 kWh pack',
    rideTime: 'Up to 70 min',
    sizes: "4'9, 5'4",
  },
  {
    board: 'Crest',
    eyebrow: 'Longest range',
    description: 'The long-range tourer: a bigger pack and a swept wing for open water.',
    material: 'Carbon sandwich hull',
    battery: '2.2 kWh pack',
    rideTime: 'Up to 80 min',
    sizes: "5'2, 5'8",
  },
  {
    board: 'Swift',
    eyebrow: 'Lightest carry',
    description: 'The lightest board in the workshop, built for quick turns and a one-arm carry.',
    material: 'Full carbon shell',
    battery: '1.0 kWh pack',
    rideTime: 'Up to 35 min',
    sizes: "4'3, 4'8, 5'2",
  },
];

export const FAQ_ROWS: { question: string; answer: string }[] = [
  {
    question: 'How long does a battery last on one charge?',
    answer: 'A Drift pack holds about 70 minutes at middle gear. The configurator quotes the exact figure for your parts, rider weight and speed gear.',
  },
  {
    question: 'Can I swap the wing later?',
    answer: 'Yes. Every SnapFit wing, mast, drive and pack clicks onto the same board, and the configurator shows which parts fit the board you chose.',
  },
  {
    question: 'Do you ship spare batteries?',
    answer: 'We do. Spare batteries ship at 30% charge or less and carry a dangerous goods handling fee, which checkout shows before you place the order.',
  },
  {
    question: 'How quickly will my board arrive?',
    answer: 'In-stock orders leave the warehouse the same business day when you order before 14:00 warehouse time, and checkout shows both the ship and arrival dates.',
  },
  {
    question: 'What is covered by the warranty?',
    answer: 'Every board carries a one-year warranty, two years in Germany and France, and every battery carries eighteen months. Protection plans extend the board cover to 2 or 3 years.',
  },
  {
    question: 'Can I trade in my old board?',
    answer: 'Yes. Submit it on the trade-in page, we quote a credit, and the credit comes off a Crest build at checkout.',
  },
  {
    question: 'Where can I try one?',
    answer: 'We run seven demo stations and book seats on demo days. Find the nearest station by city or coordinates.',
  },
  {
    question: 'How do I reach a person?',
    answer: 'Book a call with a rider advisor, open a support case, or write to the workshop. We call on weekdays between 9:00 and 17:00 in your own timezone.',
  },
];

const PRESS_QUOTES = [
  { quote: 'The quietest drive we have put under our feet this year.', source: 'Foil Review Monthly' },
  { quote: 'Snap-fit parts turn a long garage job into a one-minute swap.', source: 'Open Water Journal' },
  { quote: 'The Crest holds a line through swell that larger boards cannot.', source: 'Lift Quarterly' },
  { quote: 'A family workshop that quietly out-engineers the big names.', source: 'Tide and Carbon' },
];

function heroArt(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 640 420');
  svg.setAttribute('class', 'hero-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = `
    <rect x="0" y="0" width="640" height="420" fill="#f7fafa"/>
    <line x1="0" y1="214" x2="640" y2="214" stroke="#c6d0d2" stroke-width="2"/>
    <path d="M0 232 C 120 214, 240 250, 360 232 S 540 214, 640 236 L640 420 L0 420 Z" fill="#dbe8e9"/>
    <path d="M0 268 C 140 252, 260 286, 400 268 S 560 254, 640 272 L640 420 L0 420 Z" fill="#c3dadb"/>
    <circle cx="492" cy="128" r="46" fill="#eef3f3" stroke="#c6d0d2" stroke-width="2"/>
    <g stroke="#14171a" stroke-width="5" fill="#14171a" stroke-linejoin="round">
      <path d="M150 196 L306 186 L330 196 L306 206 L150 204 Z"/>
      <rect x="226" y="204" width="8" height="74" rx="3"/>
      <path d="M186 282 L274 276 L292 284 L274 292 L186 290 Z"/>
      <path d="M196 292 L228 288 L232 296 L198 298 Z"/>
    </g>
    <g stroke="#0e6a6a" stroke-width="4" fill="none">
      <path d="M330 196 C 372 192, 402 198, 436 206"/>
    </g>`;
  return svg;
}

function boardCard(board: string, boards: BoardPackageItem[]): HTMLElement {
  const copy = BOARD_COPY.find((item) => item.board === board);
  const sizes = boards.filter((item) => item.name.startsWith(`${board} `));
  const lowest = Math.min(...sizes.map((item) => item.price_cents));
  const terms = sizes.find((item) => item.price_cents === lowest);
  return el('article', { class: 'card stack' }, [
    el('p', { class: 'eyebrow' }, copy?.eyebrow ?? ''),
    el('h3', {}, board),
    el('p', {}, copy?.description ?? ''),
    el('div', {}, [
      el('div', { class: 'spec-row' }, [el('span', { class: 'caption' }, 'Material'), el('span', {}, copy?.material ?? '')]),
      el('div', { class: 'spec-row' }, [el('span', { class: 'caption' }, 'Battery'), el('span', {}, copy?.battery ?? '')]),
      el('div', { class: 'spec-row' }, [el('span', { class: 'caption' }, 'Ride time'), el('span', {}, copy?.rideTime ?? '')]),
      el('div', { class: 'spec-row' }, [el('span', { class: 'caption' }, 'Sizes'), el('span', {}, copy?.sizes ?? '')]),
    ]),
    el('p', { style: 'font-weight:600;margin:0' }, `From ${formatCents(lowest)}`),
    terms?.as_low_as_cents === null
      ? null
      : el('p', { class: 'financing-line', 'data-monthly-cents': terms?.as_low_as_cents ?? 0 },
          `As low as ${formatCents(terms?.as_low_as_cents ?? 0)}/mo`),
    el('a', { href: `/boards#${board.toLowerCase()}`, class: 'btn btn-secondary' }, [`Explore ${board}`, svgIcon('arrow')]),
  ]);
}

function pressCarousel(): HTMLElement {
  let index = 0;
  const quote = el('blockquote', { class: 'press-quote', style: 'margin:0' });
  const counter = el('p', { class: 'caption' });
  const paint = (): void => {
    const item = PRESS_QUOTES[index]!;
    quote.replaceChildren(el('p', { style: 'font-size:1.25rem' }, `"${item.quote}"`), el('footer', { class: 'caption' }, item.source));
    counter.textContent = `${index + 1} of 4`;
  };
  const previous = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, 'Previous quote');
  const next = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, 'Next quote');
  previous.addEventListener('click', () => {
    index = (index + PRESS_QUOTES.length - 1) % PRESS_QUOTES.length;
    paint();
  });
  next.addEventListener('click', () => {
    index = (index + 1) % PRESS_QUOTES.length;
    paint();
  });
  paint();
  return el('div', { class: 'stack' }, [quote, el('div', { class: 'row' }, [previous, next, counter])]);
}

/** The hero reveal: each line rises and fades in, 0.15 s apart. */
function playHeroReveal(nodes: HTMLElement[]): void {
  if (reducedMotion()) {
    for (const node of nodes) node.classList.add('at-rest');
    return;
  }
  nodes.forEach((node, order) => {
    node.classList.add('reveal');
    node.style.animationDelay = `${order * 0.15}s`;
    requestAnimationFrame(() => node.classList.add('revealed'));
  });
}

export async function renderHome(main: HTMLElement): Promise<void> {
  const catalog = await loadCatalog();

  const eyebrow = el('p', { class: 'eyebrow' }, 'Hand-built by a family workshop since 2018');
  const heading = el('h1', {}, 'Lift off quietly');
  const line = el('p', {}, 'Three boards, one snap-fit parts system, and a set-up for every kind of water.');
  const cta = el('a', { href: '/match', class: 'btn' }, ['Find my board', svgIcon('arrow')]);

  const hero = el('section', { class: 'hero' }, [
    el('div', {}, [eyebrow, heading, line, cta]),
    heroArt(),
  ]);

  const tiles = el('section', { class: 'band wrap' }, [
    el('h2', { class: 'sr-only' }, 'Why Tern Foils'),
    el('div', { class: 'grid grid-4' }, [
      el('article', { class: 'card stack' }, [
        el('h3', {}, 'Ride a demo first'),
        el('p', {}, 'Book a seat at one of seven demo stations and fly before you buy.'),
        el('a', { href: '/locations' }, 'Find a demo day'),
      ]),
      el('article', { class: 'card stack' }, [
        el('h3', {}, 'Snap-fit parts'),
        el('p', {}, 'Wing, mast, drive, pack and controller click on and off in under a minute.'),
      ]),
      el('article', { class: 'card stack' }, [
        el('h3', {}, 'Trade in your board'),
        el('p', {}, 'Send us your old board and put the credit toward a Crest.'),
        el('a', { href: '/trade-in' }, 'Start a trade-in'),
      ]),
      el('article', { class: 'card stack' }, [
        el('h3', {}, 'Covered for a year'),
        el('p', {}, 'Every board carries a one-year warranty and every battery eighteen months.'),
        el('a', { href: '/protection' }, 'Extend to 2 or 3 years'),
      ]),
    ]),
  ]);

  const lineup = el('section', { class: 'band band-surface' }, [
    el('div', { class: 'wrap stack' }, [
      el('p', { class: 'eyebrow' }, 'Three boards'),
      el('h2', {}, 'Pick the board that fits your water.'),
      el('a', { href: '/match' }, 'Not sure? Take the five-question quiz'),
      el('div', { class: 'grid grid-3' }, BOARD_COPY.map((copy) => boardCard(copy.board, catalog.boards))),
    ]),
  ]);

  const comparison = el('section', { class: 'band wrap' }, [
    el('h2', {}, 'Why riders choose a modular board'),
    el('div', { class: 'grid grid-2' }, [
      el('div', { class: 'stack' }, [
        el('h3', { class: 'accent-heading' }, 'Snap-fit in a minute'),
        el('p', {}, 'Lock the mast, click the wing and ride.'),
        el('h3', { class: 'accent-heading' }, 'Swap parts, keep the board'),
        el('p', {}, 'A new wing changes the ride without a new hull.'),
        el('h3', { class: 'accent-heading' }, 'Hushed drive'),
        el('p', {}, 'A direct drive you can talk over.'),
      ]),
      el('div', { class: 'stack' }, [
        el('h3', { class: 'muted' }, 'Tools and bolts'),
        el('p', { class: 'muted' }, 'A tool roll and twenty minutes on the beach.'),
        el('h3', { class: 'muted' }, 'Buy a second board'),
        el('p', { class: 'muted' }, 'A second hull for every kind of water.'),
        el('h3', { class: 'muted' }, 'Loud whine'),
        el('p', { class: 'muted' }, 'A gearbox that drowns out the water.'),
      ]),
    ]),
  ]);

  const press = el('section', { class: 'band band-surface' }, [
    el('div', { class: 'wrap stack' }, [el('h2', {}, 'What the rider magazines wrote'), pressCarousel()]),
  ]);

  const fromParts = el('section', { class: 'band wrap' }, [
    el('h2', {}, 'Build from parts'),
    el('div', { class: 'grid grid-3' }, [
      el('article', { class: 'card stack' }, [el('h3', {}, 'Wings'), el('p', {}, 'Four SnapFit wings from 120 to 180.'), el('a', { href: '/parts#wings' }, 'See wings')]),
      el('article', { class: 'card stack' }, [el('h3', {}, 'Foil boards'), el('p', {}, 'Unpowered boards for prone, wing and towed riding.'), el('a', { href: '/foil-boards' }, 'See foil boards')]),
      el('article', { class: 'card stack' }, [el('h3', {}, 'Masts'), el('p', {}, 'Aluminium and carbon masts at 28 and 32 inches.'), el('a', { href: '/parts' }, 'See masts')]),
    ]),
  ]);

  const numbers = el('section', { class: 'band band-surface' }, [
    el('div', { class: 'wrap stack' }, [
      el('h2', {}, 'Our workshop in numbers'),
      el('div', { class: 'grid grid-4' }, [
        el('div', { class: 'card' }, [el('p', { class: 'workshop-figure' }, '2018'), el('p', { class: 'caption' }, 'First board')]),
        el('div', { class: 'card' }, [el('p', { class: 'workshop-figure' }, '14'), el('p', { class: 'caption' }, 'Parts')]),
        el('div', { class: 'card' }, [el('p', { class: 'workshop-figure' }, '6'), el('p', { class: 'caption' }, 'Countries we ship to')]),
        el('div', { class: 'card' }, [el('p', { class: 'workshop-figure' }, '7'), el('p', { class: 'caption' }, 'Demo stations')]),
      ]),
    ]),
  ]);

  const questions = el('section', { class: 'band wrap' }, [
    el('h2', {}, 'Rider questions'),
    el('div', {}, FAQ_ROWS.map((row) => disclosure(row.question, row.answer))),
    el('div', { class: 'stack', style: 'margin-top:1.5rem' }, [
      el('h3', {}, 'Want a person to answer?'),
      el('a', { href: '/callback', class: 'btn btn-secondary' }, ['Book a call', svgIcon('arrow')]),
    ]),
  ]);

  main.replaceChildren(hero, tiles, lineup, comparison, press, fromParts, numbers, questions);
  playHeroReveal([eyebrow, heading, line, cta]);
  for (const section of [tiles, comparison, press, fromParts, numbers, questions]) sectionReveal(section);
  sectionReveal(lineup);
  [...lineup.querySelectorAll<HTMLElement>('article.card')].forEach((card, order) => {
    card.style.animationDelay = `${order * 0.1}s`;
    sectionReveal(card);
  });
}
