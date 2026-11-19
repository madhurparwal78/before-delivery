import { h, prefersReducedMotion, svgEl } from '../dom';
import { setTopBar } from '../router';
import { intercept } from '../shell';

const HEADLINE_LINES = ['Draft in peace.', 'Publish with eyes open.'];
const HEADLINE_TEXT = HEADLINE_LINES.join(' ');

const SUBCOPY =
  'Wire forms, schedules, webhooks and tables into automations. Test them, publish numbered versions, and replay any failed run.';

interface ExampleTab {
  name: string;
  build: () => SVGElement;
}

function node(x: number, y: number, label: string, glyph: 'mail' | 'gear' | 'bolt' | 'table' | 'form'): SVGElement {
  const glyphs: Record<string, SVGElement> = {
    mail: svgEl('path', { d: `M${x + 14} ${y + 26} h28 v20 h-28 z M${x + 14} ${y + 26} l14 12 l14 -12`, class: 'glyph' }),
    gear: svgEl('path', {
      d: `M${x + 28} ${y + 24} a12 12 0 1 0 0.1 0 z M${x + 28} ${y + 30} a6 6 0 1 1 -0.1 0 z`,
      class: 'glyph',
    }),
    bolt: svgEl('path', { d: `M${x + 24} ${y + 22} l12 0 l-6 12 l8 0 l-16 20 l4 -16 l-6 0 z`, class: 'glyph' }),
    table: svgEl('path', {
      d: `M${x + 14} ${y + 26} h28 v20 h-28 z M${x + 14} ${y + 33} h28 M${x + 28} ${y + 26} v20`,
      class: 'glyph',
    }),
    form: svgEl('path', { d: `M${x + 16} ${y + 26} h24 M${x + 16} ${y + 34} h24 M${x + 16} ${y + 42} h14`, class: 'glyph' }),
  };
  return svgEl(
    'g',
    { class: 'example-node' },
    svgEl('rect', { x, y, width: 56, height: 56, rx: 12, class: 'example-square' }),
    glyphs[glyph],
    svgEl('text', { x: x + 28, y: y + 70, 'text-anchor': 'middle', class: 'example-label' }, label),
  );
}

function connector(fromX: number, fromY: number, toX: number, toY: number): SVGElement {
  const midX = (fromX + toX) / 2;
  return svgEl('path', {
    d: `M${fromX} ${fromY} C${midX} ${fromY} ${midX} ${toY} ${toX} ${toY}`,
    class: 'example-edge',
  });
}

function port(x: number, y: number): SVGElement {
  return svgEl('circle', { cx: x, cy: y, r: 4, class: 'example-port' });
}

function plus(x: number, y: number): SVGElement {
  return svgEl(
    'g',
    { class: 'example-plus' },
    svgEl('circle', { cx: x, cy: y, r: 9 }),
    svgEl('path', { d: `M${x - 4} ${y} h8 M${x} ${y - 4} v8` }),
  );
}

function graph(...children: SVGElement[]): SVGElement {
  return svgEl(
    'svg',
    { viewBox: '0 0 420 180', class: 'example-graph', role: 'img', 'aria-hidden': 'true' },
    ...children,
  );
}

const EXAMPLES: ExampleTab[] = [
  {
    name: 'Form to table row',
    build: () =>
      graph(
        node(30, 50, 'Form', 'form'),
        port(86, 78),
        connector(86, 78, 170, 78),
        node(170, 50, 'Add row', 'table'),
        port(226, 78),
        connector(226, 78, 310, 78),
        node(310, 50, 'Send email', 'mail'),
        plus(380, 78),
      ),
  },
  {
    name: 'Schedule to email',
    build: () =>
      graph(
        node(30, 50, 'Schedule', 'gear'),
        port(86, 78),
        connector(86, 78, 190, 48),
        connector(86, 78, 190, 108),
        node(190, 20, 'Filter', 'form'),
        node(190, 80, 'Send email', 'mail'),
        plus(380, 78),
      ),
  },
  {
    name: 'Webhook to loop',
    build: () =>
      graph(
        node(30, 50, 'Webhook', 'bolt'),
        port(86, 78),
        connector(86, 78, 160, 78),
        node(160, 50, 'Loop', 'gear'),
        port(216, 78),
        connector(216, 78, 300, 48),
        connector(216, 78, 300, 118),
        node(300, 20, 'Update row', 'table'),
        node(300, 90, 'Send email', 'mail'),
      ),
  },
];

const STEP_KIND_CARDS: { title: string; body: string }[] = [
  { title: 'Triggers', body: 'Forms, schedules, webhooks, new table rows and manual starts begin a run.' },
  { title: 'Logic and waiting', body: 'Filters, branches, loops and waits shape a run on the server clock.' },
  { title: 'Tables', body: 'Add and update rows in built-in tables, and loop over every row.' },
  { title: 'Mail and webhooks', body: 'Send templated mail to members and call this app back over HTTP.' },
];

const STORIES: { company: string; headline: string; quote: string; name: string; role: string }[] = [
  {
    company: 'Cobalt Studio',
    headline: 'Order intake stopped losing forms',
    quote: 'Publishing a numbered version means our edits never go live by accident.',
    name: 'Imara Teague',
    role: 'Operations lead',
  },
  {
    company: 'Harbor Bakery',
    headline: 'Replays without a second email',
    quote: 'We replay a failed run from the step that broke, and nobody gets mailed twice.',
    name: 'Dov Marchetti',
    role: 'Support manager',
  },
  {
    company: 'Lumen Print',
    headline: 'Schedules that survive the clock change',
    quote: 'Daily runs fire once, in our own time zone, even on the day the clocks move.',
    name: 'Wren Adeyemi',
    role: 'Finance analyst',
  },
];

function pixelIcon(): HTMLElement {
  return h(
    'div',
    { class: 'pixel-icon', 'aria-hidden': 'true' },
    ...[0, 1, 2, 3, 4, 5].map((index) => h('span', { class: `pixel pixel-${index}` })),
  );
}

function revealOnScroll(element: HTMLElement): void {
  if (prefersReducedMotion() || element.getBoundingClientRect().top < window.innerHeight) {
    element.classList.add('revealed');
    return;
  }
  element.classList.add('pending-reveal');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove('pending-reveal');
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.1, rootMargin: '120px' },
  );
  observer.observe(element);
}

export async function renderLanding(): Promise<HTMLElement> {
  const reduced = prefersReducedMotion();
  const frame = h('div', { class: 'preview-frame' });
  const panel = h('div', { class: 'preview-panel' });
  const skeleton = h('div', { class: 'preview-skeleton', 'aria-hidden': 'true' });
  const tabs: HTMLElement[] = [];
  const panels: HTMLElement[] = [];

  const select = (index: number): void => {
    EXAMPLES.forEach((_example, position) => {
      const selected = position === index;
      tabs[position].setAttribute('aria-selected', selected ? 'true' : 'false');
      tabs[position].tabIndex = selected ? 0 : -1;
      panels[position].hidden = !selected;
      if (selected) {
        panels[position].classList.remove('crossfade');
        void panels[position].offsetWidth;
        if (!reduced) panels[position].classList.add('crossfade');
      }
    });
  };

  EXAMPLES.forEach((example, index) => {
    const tab = h('button', {
      type: 'button',
      role: 'tab',
      class: 'pill pill-tab',
      text: example.name,
      'aria-selected': index === 0 ? 'true' : 'false',
      'aria-disabled': 'true',
      tabIndex: index === 0 ? 0 : -1,
    });
    tab.addEventListener('click', () => {
      if (tab.getAttribute('aria-disabled') === 'true') return;
      select(index);
    });
    tab.addEventListener('keydown', (event: KeyboardEvent) => {
      if (tab.getAttribute('aria-disabled') === 'true') return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const next = (index + (event.key === 'ArrowRight' ? 1 : EXAMPLES.length - 1)) % EXAMPLES.length;
        select(next);
        tabs[next].focus();
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(index);
      }
    });
    tabs.push(tab);
    const tabPanel = h('div', { role: 'tabpanel', class: 'example-panel', 'aria-label': example.name }, example.build());
    tabPanel.hidden = index !== 0;
    panels.push(tabPanel);
  });

  panel.append(skeleton, ...panels);
  const tablist = h('div', { role: 'tablist', 'aria-label': 'Example automations', class: 'preview-tabs' }, ...tabs);
  frame.append(panel, tablist);

  const enableTabs = (): void => {
    skeleton.remove();
    panel.classList.add('preview-live');
    for (const tab of tabs) tab.setAttribute('aria-disabled', 'false');
  };

  const headline = h(
    'h1',
    { class: 'hero-headline display', 'aria-label': HEADLINE_TEXT },
    ...HEADLINE_LINES.map((line) =>
      h(
        'span',
        { class: 'headline-line' },
        ...[...line].map((letter, letterIndex) =>
          h('span', {
            class: 'headline-letter',
            'aria-hidden': 'true',
            style: reduced ? '' : `animation-delay:${letterIndex * 30}ms`,
            text: letter === ' ' ? '\u00a0' : letter,
          }),
        ),
      ),
    ),
  );

  if (reduced) {
    headline.classList.add('no-motion');
    enableTabs();
  } else {
    const lines = [...headline.querySelectorAll<HTMLElement>('.headline-line')];
    const letters = [...(lines[lines.length - 1]?.querySelectorAll<HTMLElement>('.headline-letter') ?? [])];
    const last = letters[letters.length - 1];
    last.addEventListener('animationend', () => {
      panel.classList.add('preview-arriving');
    });
    panel.addEventListener('animationend', (event: AnimationEvent) => {
      if (event.animationName === 'frame-in') enableTabs();
    });
  }

  const hero = h(
    'section',
    { class: 'hero' },
    headline,
    h('p', { class: 'hero-sub body-text', text: SUBCOPY }),
    h(
      'div',
      { class: 'hero-actions' },
      h('a', { class: 'pill pill-secondary', href: '/sign-in', onclick: intercept, text: 'Sign in' }),
      h('a', { class: 'pill pill-primary', href: '/sign-up', onclick: intercept, text: 'Create a workspace' }),
    ),
  );

  const stepKinds = h(
    'section',
    { class: 'card-row', role: 'region', 'aria-label': 'Step kinds' },
    h(
      'div',
      { class: 'card-scroller' },
      ...STEP_KIND_CARDS.map((card) =>
        h(
          'article',
          { class: 'panel panel-dark kind-card' },
          h('div', { class: 'dot-lattice card-lattice', 'aria-hidden': 'true' }, pixelIcon()),
          h('h3', { class: 'display display-small', text: card.title }),
          h('p', { class: 'card-body', text: card.body }),
        ),
      ),
    ),
  );

  const stories = h(
    'section',
    { class: 'card-row', role: 'region', 'aria-label': 'Automation stories' },
    h(
      'div',
      { class: 'card-scroller' },
      ...STORIES.map((story) =>
        h(
          'article',
          { class: 'panel panel-dark story-card' },
          h('p', { class: 'story-company mono', text: story.company }),
          h('h3', { class: 'display display-small', text: story.headline }),
          h('p', { class: 'card-body', text: `"${story.quote}"` }),
          h('p', { class: 'story-person', text: `${story.name}, ${story.role}` }),
        ),
      ),
    ),
  );

  const release = h(
    'section',
    { class: 'release-bar panel panel-dark', role: 'region', 'aria-label': 'Release notice' },
    h('p', { class: 'release-text', text: 'Runs stay on the version they started on.' }),
    h('a', {
      class: 'link-action',
      href: '#preview-frame',
      text: 'Learn more',
      onclick: (event: Event) => {
        event.preventDefault();
        frame.scrollIntoView({ block: 'center' });
      },
    }),
  );

  frame.id = 'preview-frame';
  window.requestAnimationFrame(() => {
    for (const section of [stepKinds, stories]) revealOnScroll(section);
  });
  setTopBar(release);

  return h('div', { class: 'landing' }, hero, frame, stepKinds, stories);
}
