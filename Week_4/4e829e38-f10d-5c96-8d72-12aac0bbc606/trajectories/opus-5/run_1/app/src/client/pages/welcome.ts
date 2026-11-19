import { el, on } from '../dom.js';
import { animate, reducedMotion } from '../motion.js';
import { chevron, internalLink } from '../topbar.js';
import { navigate } from '../router.js';

interface Kind {
  tab: string;
  heading: string;
  copy: string;
}

const KINDS: Kind[] = [
  {
    tab: 'Office ops',
    heading: 'Month-end close that starts itself',
    copy: 'Checklists repeat on the right day and every sign-off is recorded.',
  },
  {
    tab: 'Content',
    heading: 'Every issue moves on its own schedule',
    copy: 'Briefs, drafts and reviews repeat each cycle and rules hand them on.',
  },
  {
    tab: 'Client work',
    heading: 'Requests become tracked jobs',
    copy: 'A public form turns each request into a task with a named approver.',
  },
  {
    tab: 'Facilities',
    heading: 'Upkeep that never lapses',
    copy: 'Machine and building checks come back every week or month.',
  },
  {
    tab: 'Finance close',
    heading: 'Approvals with a clear paper trail',
    copy: 'Each decision is saved with who agreed and when.',
  },
  {
    tab: 'Studio',
    heading: 'A balanced week for every person',
    copy: 'Daily workload shows who is over capacity before a deadline slips.',
  },
];

const SHOWCASE: { tab: string; title: string; copy: string }[] = [
  {
    tab: 'List',
    title: 'A list that takes dictation',
    copy: 'Type names one after another and the rows appear in order, nesting and tags included.',
  },
  {
    tab: 'Board',
    title: 'A board you can drive by keyboard',
    copy: 'Pick a card up with Space, move it with arrows and hear every step announced.',
  },
  {
    tab: 'Timeline',
    title: 'Bars that keep their dates honest',
    copy: 'Shift a bar by a day and link a blocker to whatever waits on it.',
  },
  {
    tab: 'Workload',
    title: 'Hours spread over working days',
    copy: 'Each person shows a daily total against their own capacity.',
  },
  {
    tab: 'Rules',
    title: 'Rules that leave a record',
    copy: 'Every run is listed in firing order with the depth it ran at.',
  },
];

const RECIPES: { name: string; value: string; example: string }[] = [
  {
    name: 'Ready to review',
    value: 'Move work on as soon as it is marked ready.',
    example: 'When Stage becomes Ready, move the task to Review.',
  },
  {
    name: 'Review sets owner',
    value: 'Give every review a named owner.',
    example: 'When a task lands in Review, assign it to the reviewer on duty.',
  },
  {
    name: 'Owner flags',
    value: 'Raise priority the moment an owner changes.',
    example: 'When Assignee changes, set Priority to High.',
  },
  {
    name: 'Late order nudge',
    value: 'Tell the right person before a date slips.',
    example: 'When the due date arrives, send the task to the assignee inbox.',
  },
  {
    name: 'Checklist starter',
    value: 'Add the first step for every new job.',
    example: 'When a task is added, add the subtask Check the order sheet.',
  },
];

const FOOTER: { heading: string; links: string[] }[] = [
  { heading: 'Product', links: ['Lists', 'Boards', 'Timelines', 'Workload'] },
  { heading: 'Automation', links: ['Rules', 'Formula fields', 'Repeat rules'] },
  { heading: 'Teams', links: ['Kitchens', 'Makerspaces', 'Small offices'] },
  { heading: 'Learn', links: ['A first project', 'Weighted goals', 'Approvals'] },
  { heading: 'Workspace', links: ['Join with a team code', 'Sample request form'] },
];

function collage(kindIndex: number): HTMLElement {
  const kind = KINDS[kindIndex];
  return el('div', { class: 'collage', 'data-kind': kind.tab, 'aria-hidden': 'true' }, [
    el('div', { class: 'collage__card collage__card--row' }, [
      el('span', { class: 'collage__dot' }),
      el('span', { class: 'collage__label' }, 'Order dry goods'),
      el('span', { class: 'collage__meta tabular' }, '12 h'),
    ]),
    el('div', { class: 'collage__card collage__card--intake' }, [
      el('p', { class: 'collage__title' }, 'Supply request'),
      el('p', { class: 'collage__copy' }, kind.tab),
    ]),
    el('div', { class: 'collage__card collage__card--chip' }, [
      el('span', { class: 'chip chip--approved' }, 'Approved'),
    ]),
    el('div', { class: 'collage__card collage__card--avatars' }, [
      el('span', { class: 'avatar' }, 'NH'),
      el('span', { class: 'avatar' }, 'IM'),
      el('span', { class: 'avatar' }, 'TO'),
    ]),
    el('span', { class: 'collage__trail' }),
  ]);
}

function kindsBlock(): HTMLElement {
  const panelHeading = el('h2', { class: 'section-heading' }, KINDS[0].heading);
  const panelCopy = el('p', { class: 'section-copy' }, KINDS[0].copy);
  let collageHost = collage(0);

  const tablist = el('div', {
    role: 'tablist',
    'aria-label': 'Team kinds',
    class: 'chip-row',
  });
  const panel = el('div', { role: 'tabpanel', class: 'kinds__panel' }, [panelHeading, panelCopy]);
  const tabs: HTMLButtonElement[] = [];

  const select = (index: number) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
      tab.tabIndex = i === index ? 0 : -1;
      tab.classList.toggle('chip--active', i === index);
    });
    panelHeading.textContent = KINDS[index].heading;
    panelCopy.textContent = KINDS[index].copy;
    const next = collage(index);
    next.setAttribute('data-motion', reducedMotion() ? 'settled' : 'entering');
    collageHost.replaceWith(next);
    collageHost = next;
    animate(
      330,
      () => undefined,
      () => next.setAttribute('data-motion', 'settled'),
    );
  };

  KINDS.forEach((kind, index) => {
    const tab = el(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: `chip${index === 0 ? ' chip--active' : ''}`,
        'aria-selected': index === 0 ? 'true' : 'false',
        tabindex: index === 0 ? 0 : -1,
      },
      kind.tab,
    );
    on(tab, 'click', () => select(index));
    on(tab, 'keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const next = (index + (event.key === 'ArrowRight' ? 1 : KINDS.length - 1)) % KINDS.length;
        select(next);
        tabs[next].focus();
      }
    });
    tabs.push(tab);
    tablist.appendChild(tab);
  });

  const signUp = el('form', { class: 'signup-block' }, [
    el('div', { class: 'signup-block__pills' }, [
      internalLink('Join with a team code', '/account', 'pill pill--outline'),
      internalLink('Open a sample request form', '/f/supply-request', 'pill pill--outline'),
    ]),
    el('p', { class: 'divider' }, 'or'),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label' }, 'Work email'),
      el('input', { type: 'email', class: 'input', 'aria-label': 'Work email', name: 'email' }),
    ]),
    el('button', { type: 'submit', class: 'pill pill--dark' }, 'Sign up'),
  ]) as HTMLFormElement;
  on(signUp, 'submit', (event) => {
    event.preventDefault();
    const input = signUp.querySelector('input') as HTMLInputElement;
    navigate(`/account?email=${encodeURIComponent(input.value)}`);
  });

  const left = el('div', { class: 'two-col__left' }, [
    el('h2', { class: 'section-heading' }, 'Build the week once'),
    el(
      'p',
      { class: 'section-copy' },
      'Sections, custom fields and rules do the copying, so Monday starts itself.',
    ),
    signUp,
  ]);
  const right = el('div', { class: 'two-col__right' }, [collageHost]);

  return el('section', { class: 'two-col' }, [
    el('div', { class: 'chip-row-wrap' }, tablist),
    panel,
    el('div', { class: 'two-col__grid' }, [right, left]),
  ]);
}

function showcase(): HTMLElement {
  const tablist = el('div', {
    role: 'tablist',
    'aria-label': 'Showcase views',
    class: 'chip-row chip-row--dark',
  });
  const cards = SHOWCASE.map((item) =>
    el('article', { class: 'showcase-card' }, [
      el('span', { class: 'icon-tile', 'aria-hidden': 'true' }),
      el('h3', { class: 'showcase-card__title' }, item.title),
      el('p', { class: 'showcase-card__copy' }, item.copy),
      el('div', { class: 'showcase-card__mock', 'aria-hidden': 'true' }),
    ]),
  );
  const track = el('div', { class: 'showcase__track' }, cards);
  const tabs: HTMLButtonElement[] = [];
  const select = (index: number) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
      tab.tabIndex = i === index ? 0 : -1;
      tab.classList.toggle('chip--active', i === index);
    });
    cards.forEach((card, i) => card.classList.toggle('is-centre', i === index));
    animate(
      330,
      (eased) => track.style.setProperty('--shift', `${-index * 320 * eased}px`),
      () => track.setAttribute('data-motion', 'settled'),
    );
  };
  SHOWCASE.forEach((item, index) => {
    const tab = el(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: `chip chip--large${index === 0 ? ' chip--active' : ''}`,
        'aria-selected': index === 0 ? 'true' : 'false',
        tabindex: index === 0 ? 0 : -1,
      },
      item.tab,
    );
    on(tab, 'click', () => select(index));
    on(tab, 'keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const nextIndex =
          (index + (event.key === 'ArrowRight' ? 1 : SHOWCASE.length - 1)) % SHOWCASE.length;
        select(nextIndex);
        tabs[nextIndex].focus();
      }
    });
    tabs.push(tab);
    tablist.appendChild(tab);
  });
  select(0);
  return el('section', { class: 'band band--dark showcase' }, [
    el('h2', { class: 'section-heading section-heading--light' }, 'Five views, one record'),
    tablist,
    el('div', { class: 'showcase__viewport' }, track),
    el(
      'div',
      { class: 'showcase__dots', 'aria-hidden': 'true' },
      SHOWCASE.map(() => el('span', { class: 'dot' })),
    ),
  ]);
}

function recipesBand(): HTMLElement {
  const cards = RECIPES.map((recipe) =>
    el('article', { class: 'recipe-card' }, [
      el('span', { class: 'blob', 'aria-hidden': 'true' }),
      el('h3', { class: 'recipe-card__title' }, recipe.name),
      el('p', { class: 'recipe-card__value' }, recipe.value),
      el('p', { class: 'recipe-card__example' }, recipe.example),
    ]),
  );
  const track = el('div', { class: 'recipes__track' }, cards);
  let index = 0;
  const previous = el(
    'button',
    { type: 'button', class: 'round-button', 'aria-label': 'Previous recipes' },
    chevron(),
  );
  const next = el(
    'button',
    { type: 'button', class: 'round-button', 'aria-label': 'Next recipes' },
    chevron(),
  );
  const update = () => {
    previous.disabled = index === 0;
    next.disabled = index >= cards.length - 1;
    animate(
      330,
      (eased) => track.style.setProperty('--shift', `${-index * 320 * eased}px`),
      () => track.setAttribute('data-motion', 'settled'),
    );
  };
  on(previous, 'click', () => {
    index = Math.max(0, index - 1);
    update();
  });
  on(next, 'click', () => {
    index = Math.min(cards.length - 1, index + 1);
    update();
  });
  update();
  return el('section', { class: 'band band--grey recipes-band' }, [
    el('h2', { class: 'section-heading' }, 'Start from a recipe'),
    el('div', { class: 'recipes', role: 'region', 'aria-label': 'Rule recipes' }, [
      el('div', { class: 'recipes__viewport' }, track),
      el('div', { class: 'recipes__arrows' }, [previous, next]),
    ]),
  ]);
}

export function renderWelcome(main: HTMLElement): void {
  main.className = 'page page--welcome';
  const hero = el('section', { class: 'hero' }, [
    el('h1', { class: 'hero__headline' }, 'Recurring work that runs itself'),
    el(
      'p',
      { class: 'hero__sub' },
      'Everyweek keeps the same routines going: the orders, the upkeep, the close.',
    ),
  ]);

  const story = el('section', { class: 'story' }, [
    el('div', { class: 'story__portrait', 'aria-hidden': 'true' }),
    el('div', { class: 'story__text' }, [
      el(
        'blockquote',
        { class: 'story__quote' },
        'We used to rebuild the week by hand every Monday. Now the week is already there and we just work it.',
      ),
      el('p', { class: 'story__name' }, 'Noor Halvorsen'),
      el('p', { class: 'story__title' }, 'Operations coordinator, Larder Street Kitchen'),
    ]),
  ]);

  const start = el('section', { class: 'band band--dark start-band' }, [
    el('h2', { class: 'start-band__headline' }, 'Start your workspace'),
    internalLink('Get started', '/account', 'pill pill--light'),
    el('hr', { class: 'rule' }),
    el('p', { class: 'footnote' }, 'Three people, one join code and the first project in a minute.'),
  ]);

  const toTop = el(
    'button',
    { type: 'button', class: 'round-button', 'aria-label': 'Back to top' },
    chevron(),
  );
  on(toTop, 'click', () => window.scrollTo({ top: 0 }));

  const footer = el('footer', { class: 'band band--dark site-footer' }, [
    el(
      'div',
      { class: 'site-footer__columns' },
      FOOTER.map((column) =>
        el('div', { class: 'site-footer__column' }, [
          el('p', { class: 'site-footer__heading' }, column.heading),
          el(
            'ul',
            {},
            column.links.map((link) => el('li', {}, el('a', { href: '/account' }, link))),
          ),
        ]),
      ),
    ),
    el('div', { class: 'site-footer__bottom' }, [el('p', {}, 'Corran & Bly, 2026'), toTop]),
  ]);

  main.append(hero, kindsBlock(), showcase(), recipesBand(), story, start, footer);
}
