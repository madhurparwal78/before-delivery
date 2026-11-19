import { demoList, demoNesting, marketing } from '../shared/copy.js';
import { clear, el, icon, icons } from './dom.js';
import { reducedMotion } from './regions.js';

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Enter', action: 'New bullet' },
  { keys: 'Tab', action: 'Indent' },
  { keys: 'Shift + Tab', action: 'Outdent' },
  { keys: 'Ctrl + ↑', action: 'Move up' },
  { keys: 'Ctrl + ↓', action: 'Move down' },
  { keys: 'Ctrl + Space', action: 'Fold' },
  { keys: 'Alt + →', action: 'Zoom in' },
  { keys: 'Alt + ←', action: 'Zoom out' },
  { keys: 'Ctrl + Enter', action: 'Complete' },
  { keys: 'Ctrl + Shift + M', action: 'Mirror' },
  { keys: 'Ctrl + Z', action: 'Undo' }
];

const QUOTES: Array<{ name: string; role: string; quote: string }> = [
  {
    name: 'Ines Varga',
    role: 'allotment secretary',
    quote: 'I keep the whole allotment plan in one list and zoom into this week’s jobs.'
  },
  {
    name: 'Tomasz Lind',
    role: 'novelist',
    quote: 'Chapters, scenes and beats, nested the way I actually think.'
  },
  {
    name: 'Priya Nandakumar',
    role: 'student',
    quote: 'I shared one branch with my lab partner and nothing else.'
  }
];

const ROLE_CARDS: Array<{ title: string; points: string[] }> = [
  {
    title: 'Outline owner',
    points: [
      'Write, zoom, mirror and share any branch',
      'Undo from every tab',
      'Download as plain text, Markdown or OPML'
    ]
  },
  {
    title: 'Collaborator',
    points: [
      'Edit only the branch you were invited to',
      'See the owner’s edits live',
      'Download that branch'
    ]
  }
];

const FOOTER: Array<{ title: string; links: string[] }> = [
  { title: 'Twigline', links: ['Outline demo', 'Every move has a key', 'Four views', 'Sign in'] },
  { title: 'Outlining', links: ['Keyboard first', 'Folding', 'Mirrors'] },
  { title: 'Sharing', links: ['One branch', 'Live edits', 'Ending access'] },
  { title: 'Downloads', links: ['Plain text', 'Markdown', 'OPML'] },
  { title: 'Pellwick & Ash', links: ['About', 'Writing', 'Contact'] }
];

function pill(label: string, href: string, kind: 'accent' | 'email'): HTMLAnchorElement {
  const node = el('a', { class: `pill pill-${kind}`, href }, [
    kind === 'email' ? icon(icons.at) : null,
    el('span', {}, [label])
  ]);
  return node;
}

function brandMark(): HTMLElement {
  const mark = el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, [
    icon('M12 21V8m0 0L7 4m5 4 5-4M12 14l-4-3m4 3 4-3')
  ]);
  return mark;
}

function topBar(): HTMLElement {
  const links = el('nav', { class: 'top-links', 'aria-label': 'Sections' }, [
    el('a', { href: '#outlining' }, ['Outlining']),
    el('a', { href: '#sharing' }, ['Sharing']),
    el('a', { href: '#downloads' }, ['Downloads'])
  ]);
  const menuButton = el('button', { type: 'button', class: 'menu-button', 'aria-expanded': 'false' }, [
    icon(icons.menu),
    el('span', { class: 'visually-hidden' }, ['Menu'])
  ]);
  menuButton.setAttribute('aria-label', 'Menu');
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', open ? 'false' : 'true');
    links.classList.toggle('open', !open);
  });
  return el('header', { class: 'top-bar' }, [
    el('div', { class: 'top-bar-inner' }, [
      el('a', { class: 'brand', href: '/' }, [brandMark(), el('span', { class: 'wordmark' }, ['Twigline'])]),
      el('div', { class: 'top-bar-right' }, [
        links,
        menuButton,
        pill('Start your outline', '/signup', 'accent')
      ])
    ])
  ]);
}

/** A field of pale dots whose silhouette is a branching tree. */
function dotField(): HTMLCanvasElement {
  const canvas = el('canvas', { class: 'dot-field', 'aria-hidden': 'true', width: 1200, height: 520 });
  const draw = (): void => {
    const context = canvas.getContext('2d');
    if (context === null) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const points: Array<{ x: number; y: number }> = [];
    const branch = (x: number, y: number, angle: number, length: number, depth: number): void => {
      const steps = Math.max(6, Math.round(length / 9));
      for (let step = 0; step <= steps; step += 1) {
        const travel = (length * step) / steps;
        points.push({ x: x + Math.cos(angle) * travel, y: y + Math.sin(angle) * travel });
      }
      if (depth === 0) return;
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;
      branch(endX, endY, angle - 0.52, length * 0.78, depth - 1);
      branch(endX, endY, angle + 0.55, length * 0.76, depth - 1);
      if (depth > 3) branch(endX, endY, angle + 0.02, length * 0.62, depth - 2);
    };
    branch(width / 2, height - 8, -Math.PI / 2, 150, 5);
    for (const point of points) {
      const edge = Math.min(
        1,
        Math.min(point.x, width - point.x) / (width * 0.42),
        Math.min(point.y, height - point.y) / (height * 0.6) + 0.25
      );
      const alpha = Math.max(0, 0.34 * edge);
      context.beginPath();
      context.fillStyle = `rgba(148, 163, 184, ${alpha.toFixed(3)})`;
      context.arc(point.x, point.y, 2, 0, Math.PI * 2);
      context.fill();
    }
  };
  draw();
  return canvas;
}

interface DemoLine {
  text: string;
  parent: string | null;
}

function demoLines(nested: boolean): DemoLine[] {
  if (!nested) return demoList.map((text) => ({ text, parent: null }));
  const lines: DemoLine[] = [];
  for (const group of demoNesting) {
    lines.push({ text: group.parent, parent: null });
    for (const child of group.children) lines.push({ text: child, parent: group.parent });
  }
  return lines;
}

function renderDemoList(target: HTMLElement, nested: boolean, animate: boolean): void {
  clear(target);
  const list = el('ul', { class: 'demo-list', role: 'list' });
  let order = 0;
  for (const line of demoLines(nested)) {
    const isParent = nested && demoNesting.some((group) => group.parent === line.text);
    const item = el('li', { class: 'demo-row' }, [
      el('span', { class: 'demo-dot', 'aria-hidden': 'true' }),
      el('span', { class: isParent ? 'demo-text is-parent' : 'demo-text' }, [line.text])
    ]);
    if (line.parent !== null) {
      item.classList.add('demo-child');
      if (animate) {
        item.style.animationDelay = `${order * 40}ms`;
        item.classList.add('slide-in');
        order += 1;
      }
    }
    list.append(item);
  }
  target.append(list);
}

function heroDemo(): HTMLElement {
  const body = el('div', { class: 'window-body' });
  const nestButton = el('button', { type: 'button', class: 'pill pill-outline nest-it' }, ['Nest it']);
  nestButton.setAttribute('aria-pressed', 'false');
  const region = el('section', { class: 'outline-window hero-window', role: 'region', 'aria-label': 'Outline demo' }, [
    el('div', { class: 'window-bar', 'aria-hidden': 'true' }, [
      el('span', { class: 'window-dot' }),
      el('span', { class: 'window-dot' }),
      el('span', { class: 'window-dot' })
    ]),
    body,
    el('div', { class: 'window-foot' }, [nestButton])
  ]);

  let nested = false;
  nestButton.addEventListener('click', () => {
    if (nestButton.getAttribute('aria-disabled') === 'true') return;
    nested = !nested;
    nestButton.setAttribute('aria-pressed', nested ? 'true' : 'false');
    renderDemoList(body, nested, !reducedMotion());
  });

  const finish = (): void => {
    renderDemoList(body, false, false);
    nestButton.removeAttribute('aria-disabled');
  };

  if (reducedMotion()) {
    finish();
    return region;
  }

  nestButton.setAttribute('aria-disabled', 'true');
  const list = el('ul', { class: 'demo-list', role: 'list' });
  body.append(list);
  let started = false;
  const type = (): void => {
    if (started) return;
    started = true;
    let lineIndex = 0;
    let characterIndex = 0;
    const row = (): HTMLElement => list.children[lineIndex] as HTMLElement;
    const addRow = (): void => {
      list.append(
        el('li', { class: 'demo-row' }, [
          el('span', { class: 'demo-dot', 'aria-hidden': 'true' }),
          el('span', { class: 'demo-text' }),
          el('span', { class: 'caret', 'aria-hidden': 'true' })
        ])
      );
    };
    addRow();
    const tick = (): void => {
      const line = demoList[lineIndex];
      if (line === undefined) {
        for (const caret of list.querySelectorAll('.caret')) caret.remove();
        nestButton.removeAttribute('aria-disabled');
        return;
      }
      characterIndex += 1;
      const text = row().querySelector('.demo-text');
      if (text !== null) text.textContent = line.slice(0, characterIndex);
      if (characterIndex >= line.length) {
        const caret = row().querySelector('.caret');
        if (caret !== null) caret.remove();
        lineIndex += 1;
        characterIndex = 0;
        if (lineIndex < demoList.length) addRow();
      }
      window.setTimeout(tick, 34);
    };
    tick();
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          type();
          observer.disconnect();
        }
      }
    },
    { threshold: 0.2 }
  );
  window.setTimeout(() => observer.observe(region), 0);
  return region;
}

function shortcutStrip(): HTMLElement {
  return el('section', { class: 'band band-pale section', id: 'shortcuts' }, [
    el('div', { class: 'column' }, [
      el('h2', { class: 'strip-label' }, [marketing.shortcutStripLabel]),
      el(
        'ul',
        { class: 'shortcut-strip', role: 'list' },
        SHORTCUTS.map((shortcut) =>
          el('li', { class: 'shortcut' }, [
            el('kbd', {}, [shortcut.keys]),
            el('span', {}, [shortcut.action])
          ])
        )
      )
    ])
  ]);
}

const VIEW_NAMES = ['List', 'Board', 'Tasks', 'Plain text'] as const;
type ViewName = (typeof VIEW_NAMES)[number];

function renderDemoView(target: HTMLElement, view: ViewName): void {
  clear(target);
  if (view === 'List') {
    renderDemoList(target, true, false);
    return;
  }
  if (view === 'Board') {
    const board = el('div', { class: 'demo-board' });
    for (const group of demoNesting) {
      board.append(
        el('div', { class: 'demo-column' }, [
          el('p', { class: 'demo-column-title' }, [group.parent]),
          el(
            'ul',
            { class: 'demo-cards', role: 'list' },
            group.children.map((child) => el('li', { class: 'demo-card' }, [child]))
          )
        ])
      );
    }
    target.append(board);
    return;
  }
  if (view === 'Tasks') {
    const list = el('ul', { class: 'demo-list demo-tasks', role: 'list' });
    for (const group of demoNesting) {
      list.append(
        el('li', { class: 'demo-row' }, [el('span', { class: 'demo-text is-parent' }, [group.parent])])
      );
      for (const child of group.children) {
        list.append(
          el('li', { class: 'demo-row demo-child' }, [
            el('span', { class: 'demo-check', 'aria-hidden': 'true' }),
            el('span', { class: 'demo-text' }, [child])
          ])
        );
      }
    }
    target.append(list);
    return;
  }
  const lines: string[] = [];
  for (const group of demoNesting) {
    lines.push(`- ${group.parent}`);
    for (const child of group.children) lines.push(`  - ${child}`);
  }
  target.append(el('pre', { class: 'demo-plain' }, [lines.join('\n')]));
}

function featureSection(): HTMLElement {
  const body = el('div', { class: 'window-body' });
  const tabs = el('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Demo views' });
  let current: ViewName = 'List';
  const buttons = new Map<ViewName, HTMLButtonElement>();

  const show = (view: ViewName): void => {
    current = view;
    for (const [name, button] of buttons) {
      const selected = name === view;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.setAttribute('tabindex', selected ? '0' : '-1');
      button.classList.toggle('active', selected);
    }
    if (reducedMotion()) {
      renderDemoView(body, view);
      return;
    }
    body.classList.add('fading');
    window.setTimeout(() => {
      renderDemoView(body, view);
      body.classList.remove('fading');
    }, 150);
  };

  for (const name of VIEW_NAMES) {
    const button = el('button', { type: 'button', role: 'tab', class: 'segment' }, [name]);
    button.addEventListener('click', () => show(name));
    buttons.set(name, button);
    tabs.append(button);
  }

  const next = el('button', { type: 'button', class: 'pill pill-accent next-view' }, [
    el('span', {}, ['Next view']),
    icon(icons.forward)
  ]);
  next.setAttribute('aria-label', 'Next view');
  next.addEventListener('click', () => {
    const index = VIEW_NAMES.indexOf(current);
    show(VIEW_NAMES[(index + 1) % VIEW_NAMES.length]!);
  });

  renderDemoView(body, 'List');
  show('List');

  return el('section', { class: 'band band-white section', id: 'outlining' }, [
    el('div', { class: 'column' }, [
      el('h2', {}, [marketing.featureHeading]),
      el('div', { class: 'view-switcher' }, [next, tabs]),
      el('div', { class: 'outline-window feature-window' }, [body])
    ])
  ]);
}

function quoteCards(): HTMLElement {
  return el('section', { class: 'band band-pale section', id: 'sharing' }, [
    el('div', { class: 'column' }, [
      el('h2', {}, ['Three people, one list each']),
      el(
        'div',
        { class: 'card-grid' },
        QUOTES.map((quote) =>
          el('figure', { class: 'card quote-card' }, [
            el('blockquote', {}, [quote.quote]),
            el('figcaption', {}, [`${quote.name}, ${quote.role}`])
          ])
        )
      )
    ])
  ]);
}

function roleCards(): HTMLElement {
  return el('section', { class: 'band band-white section' }, [
    el('div', { class: 'column' }, [
      el('h2', {}, ['Two ways in']),
      el(
        'div',
        { class: 'card-grid card-grid-two' },
        ROLE_CARDS.map((card) =>
          el('div', { class: 'card role-card' }, [
            el('h3', {}, [card.title]),
            el(
              'ul',
              { role: 'list' },
              card.points.map((point) => el('li', {}, [point]))
            ),
            pill('Start your outline', '/signup', 'accent')
          ])
        )
      ),
      el('div', { class: 'callout' }, [
        el('p', {}, [marketing.keyboardHelp]),
        el('a', { class: 'accent-link', href: '#shortcuts' }, [marketing.keyboardHelpLink])
      ])
    ])
  ]);
}

function downloadTiles(): HTMLElement {
  return el('section', { class: 'band band-pale section', id: 'downloads' }, [
    el('div', { class: 'column' }, [
      el('h2', {}, ['Take it with you']),
      el(
        'div',
        { class: 'tile-row' },
        ['Plain text', 'Markdown', 'OPML'].map((name) =>
          el('div', { class: 'tile' }, [
            icon(icons.download),
            el('h3', {}, [name]),
            el('p', {}, ['Every depth, tag, date and completion, in one file.'])
          ])
        )
      )
    ])
  ]);
}

function closingBlock(): HTMLElement {
  return el('section', { class: 'band band-white section closing' }, [
    el('div', { class: 'column' }, [
      el('h2', {}, [marketing.closingHeading]),
      el('div', { class: 'hero-pills' }, [
        pill('Start your outline', '/signup', 'accent'),
        pill('Sign in with email', '/signin', 'email')
      ])
    ])
  ]);
}

function footer(): HTMLElement {
  return el('footer', { class: 'band band-pale site-footer' }, [
    el(
      'div',
      { class: 'column footer-columns' },
      FOOTER.map((group) =>
        el('div', { class: 'footer-column' }, [
          el('h2', {}, [group.title]),
          el(
            'ul',
            { role: 'list' },
            group.links.map((link) => el('li', {}, [el('a', { href: '#outlining' }, [link])]))
          )
        ])
      )
    )
  ]);
}

/** The signed-out marketing page. */
export function renderMarketing(root: HTMLElement): void {
  clear(root);
  root.append(
    topBar(),
    el('main', {}, [
      el('section', { class: 'band band-white hero' }, [
        el('div', { class: 'column hero-column' }, [
          dotField(),
          el('h1', { class: 'hero-headline' }, [
            el('span', {}, [marketing.headlineOne]),
            el('span', {}, [marketing.headlineTwo])
          ]),
          el('p', { class: 'lead' }, [marketing.lead]),
          el('div', { class: 'hero-pills' }, [
            pill('Start your outline', '/signup', 'accent'),
            pill('Sign in with email', '/signin', 'email')
          ]),
          heroDemo()
        ])
      ]),
      shortcutStrip(),
      featureSection(),
      quoteCards(),
      roleCards(),
      downloadTiles(),
      closingBlock()
    ]),
    footer()
  );
}
