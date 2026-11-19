import { el, icon, reducedMotion } from './api.js';

const DEMO_LIST: [string, number][] = [
  ['Prepare the site', 0],
  ['Clear the lot', 0],
  ['Test the soil', 0],
  ['Plant the beds', 0],
  ['Tomatoes', 0],
  ['Herb spiral', 0],
  ['Find helpers', 0],
  ['Saturday crew', 0],
];

const NEST_PARENTS = new Set(['Prepare the site', 'Plant the beds', 'Find helpers']);

export function renderMarketing(root: HTMLElement): void {
  root.innerHTML = '';
  root.appendChild(topBar());
  root.appendChild(hero());
  root.appendChild(shortcutStrip());
  root.appendChild(featureSection());
  root.appendChild(quoteSection());
  root.appendChild(roleSection());
  root.appendChild(downloadSection());
  root.appendChild(closingBlock());
  root.appendChild(footer());
  void setupHero();
  void setupFeature();
}

function topBar(): HTMLElement {
  const nav = el('nav', null,
    el('a', { href: '#features' }, 'Features'),
    el('a', { href: '#views' }, 'Views'),
    el('a', { href: '#downloads' }, 'Downloads'),
    el('a', { href: '/signup', class: 'pill', 'data-name': 'Start your outline' }, 'Start your outline'),
  );
  const menuButton = el('button', { class: 'menu-button', 'aria-label': 'Menu', hidden: '' }, icon('menu'));
  return el('header', { class: 'topbar' },
    el('a', { class: 'brand', href: '/' }, brandMark(), 'Twigline'),
    nav,
    menuButton,
  );
}

function brandMark(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');
  const trunk = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  trunk.setAttribute('d', 'M12 21V9M12 9L7 5M12 9l5-4M12 15l-5-3M12 15l5-3');
  trunk.setAttribute('stroke', '#2f9be0');
  trunk.setAttribute('stroke-width', '2.4');
  trunk.setAttribute('fill', 'none');
  trunk.setAttribute('stroke-linecap', 'round');
  svg.appendChild(trunk);
  return svg;
}

function hero(): HTMLElement {
  const section = el('section', { class: 'hero' });
  const canvas = el('canvas', { class: 'hero-canvas', 'aria-hidden': 'true' });
  const inner = el('div', { class: 'page hero-inner' },
    el('h1', null, 'Think in branches.', document.createElement('br'), 'Zoom into the one that matters.'),
    el('p', { class: 'lead' }, 'One outline for plans, drafts and lists. Fold it, mirror it, and share a single branch.'),
    el('div', { class: 'pills' },
      el('a', { href: '/signup', class: 'pill', 'data-name': 'Start your outline' }, 'Start your outline'),
      el('a', { href: '/signin', class: 'pill pill-outline', 'data-name': 'Sign in with email' }, icon('at'), 'Sign in with email'),
    ),
    heroWindow(),
  );
  section.appendChild(canvas);
  section.appendChild(inner);
  return section;
}

function heroWindow(): HTMLElement {
  const list = el('ul', { class: 'demo-list', id: 'hero-demo-list' });
  const nestButton = el('button', { class: 'pill', id: 'nest-button', 'aria-pressed': 'false', 'aria-disabled': 'true', disabled: '' }, 'Nest it');
  const region = el('div', { class: 'window', role: 'region', 'aria-label': 'Outline demo' },
    el('div', { class: 'window-toolbar' },
      el('div', { class: 'dot-trio' }, el('span'), el('span'), el('span')),
    ),
    el('div', { class: 'window-body' }, list),
    el('div', { class: 'nest-row' }, nestButton),
  );
  return region;
}

async function setupHero(): Promise<void> {
  const list = document.getElementById('hero-demo-list') as HTMLUListElement | null;
  const nestButton = document.getElementById('nest-button') as HTMLButtonElement | null;
  if (!list || !nestButton) return;
  drawCanvas();
  const reduce = reducedMotion();
  const flat: { li: HTMLLIElement; caret: HTMLSpanElement | null }[] = [];
  let nested = false;

  const finishItem = (index: number) => {
    const item = flat[index]?.li;
    if (!item) return;
    const caret = flat[index]?.caret;
    if (caret) caret.remove();
    if (index < DEMO_LIST.length - 1 && !reduce) {
      typeNext(index + 1);
    } else {
      nestButton.setAttribute('aria-disabled', 'false');
      nestButton.disabled = false;
    }
  };

  const typeNext = (index: number) => {
    if (index >= DEMO_LIST.length) {
      nestButton.setAttribute('aria-disabled', 'false');
      nestButton.disabled = false;
      return;
    }
    const [text] = DEMO_LIST[index] as [string, number];
    const li = el('li');
    const span = el('span', { class: 'text' });
    const caret = el('span', { class: 'caret' });
    li.appendChild(span);
    li.appendChild(caret);
    list.appendChild(li);
    flat.push({ li, caret });
    let shown = 0;
    const step = () => {
      if (shown >= text.length) {
        window.setTimeout(() => finishItem(index), 240);
        return;
      }
      shown += 1;
      span.textContent = text.slice(0, shown);
      window.setTimeout(step, 30 + Math.random() * 30);
    };
    step();
  };

  if (reduce) {
    for (const [text] of DEMO_LIST) {
      const li = el('li', null, el('span', { class: 'text' }, text));
      list.appendChild(li);
      flat.push({ li, caret: null });
    }
    nestButton.setAttribute('aria-disabled', 'false');
    nestButton.disabled = false;
  } else {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        typeNext(0);
      }
    }, { threshold: 0.2 });
    observer.observe(list);
  }

  nestButton.addEventListener('click', () => {
    nested = !nested;
    nestButton.setAttribute('aria-pressed', String(nested));
    applyNesting(list, nested, reduce);
  });
}

function applyNesting(list: HTMLElement, nested: boolean, reduce: boolean): void {
  const items = list.querySelectorAll('li');
  let delay = 0;
  items.forEach((li) => {
    const text = li.querySelector('.text')?.textContent ?? '';
    const isParent = NEST_PARENTS.has(text);
    const isChild = nested && !isParent;
    if (isParent) {
      li.classList.add('parent');
    } else {
      li.classList.remove('parent');
    }
    if (isChild) {
      if (!reduce) {
        window.setTimeout(() => {
          li.classList.add('child');
        }, delay);
        delay += 40;
      } else {
        li.classList.add('child');
      }
    } else {
      li.classList.remove('child');
    }
  });
}

function drawCanvas(): void {
  const canvas = document.querySelector('.hero-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    paint();
  };
  const paint = () => {
    const width = canvas.width / devicePixelRatio;
    const height = canvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, width, height);
    const spacing = 26;
    ctx.fillStyle = '#d8dee5';
    const cx = width / 2;
    const cy = height * 0.45;
    for (let x = spacing / 2; x < width; x += spacing) {
      for (let y = spacing / 2; y < height; y += spacing) {
        const d = Math.hypot(x - cx, y - cy) / Math.max(width, height);
        if (d > 0.42) continue;
        const branch = silhouette(x - cx, y - cy);
        if (branch <= 0) continue;
        const alpha = 0.55 * (1 - d / 0.42) * Math.min(1, branch);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };
  window.addEventListener('resize', resize);
  resize();
}

function silhouette(x: number, y: number): number {
  const scale = 1 / 46;
  let px = x * scale;
  let py = -y * scale;
  let qx = 0;
  let qy = 1;
  let value = 0;
  for (let i = 0; i < 7; i += 1) {
    const nx = (px + qx) * 0.7071 - (py + qy) * 0.7071;
    const ny = (px + qx) * 0.7071 + (py + qy) * 0.7071;
    px = nx;
    py = ny;
    qx = qx * 0.7071 + qy * 0.7071;
    qy = qy * 0.7071 - qx * 0.7071;
    value = Math.max(value, Math.cos(3 * Math.atan2(ny, nx)) * 0.5 + 0.5);
  }
  const dist = Math.hypot(px, py);
  const falloff = Math.max(0, 1 - dist / 2.4);
  return falloff * value;
}

function shortcutStrip(): HTMLElement {
  const keys: [string, string][] = [
    ['Enter', 'New bullet'],
    ['Tab', 'Indent'],
    ['Shift+Tab', 'Outdent'],
    ['Ctrl+↑ / Ctrl+↓', 'Move'],
    ['Alt+→', 'Zoom in'],
    ['Alt+←', 'Zoom out'],
    ['Ctrl+Enter', 'Complete'],
    ['Ctrl+Shift+M', 'Mirror'],
    ['Ctrl+Z', 'Undo'],
  ];
  return el('section', { class: 'shortcut-strip', id: 'keys' },
    el('div', { class: 'page' },
      el('h2', null, 'Every move has a key'),
      el('div', { class: 'keys' },
        ...keys.map(([key, action]) =>
          el('div', null, el('kbd', null, key), ` ${action}`),
        ),
      ),
    ),
  );
}

function featureSection(): HTMLElement {
  const demoWindow = el('div', { class: 'window' },
    el('div', { class: 'window-toolbar' }, el('div', { class: 'dot-trio' }, el('span'), el('span'), el('span'))),
    el('div', { class: 'window-body', id: 'feature-demo-body' }),
  );
  const nextButton = el('button', { class: 'pill', id: 'next-view-button' }, 'Next view');
  const tablist = el('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Demo views' });
  const tabs = ['List', 'Board', 'Tasks', 'Plain text'];
  tabs.forEach((tab, index) => {
    const button = el('button', { class: 'segment', role: 'tab', 'aria-selected': index === 0 ? 'true' : 'false', 'data-view': tab }, tab);
    tablist.appendChild(button);
  });
  return el('section', { class: 'feature-section', id: 'views' },
    el('div', { class: 'page' },
      el('h2', null, 'One list, four ways to see it'),
      el('p', { class: 'feature-lead' }, 'The same outline, folded, boarded, checked or plain.'),
      el('div', { class: 'pills' }, nextButton),
      el('div', null, tablist),
      demoWindow,
    ),
  );
}

async function setupFeature(): Promise<void> {
  const body = document.getElementById('feature-demo-body');
  const tablist = document.querySelector('[role="tablist"]');
  const nextButton = document.getElementById('next-view-button');
  if (!body || !tablist || !nextButton) return;
  let active = 0;
  const tabs = [...tablist.querySelectorAll('button')];

  const render = (index: number) => {
    body.innerHTML = '';
    const view = tabs[index]?.dataset.view ?? 'List';
    if (view === 'List') {
      const list = el('ul', { class: 'demo-list' });
      for (const [text] of DEMO_LIST) {
        const li = el('li', { class: NEST_PARENTS.has(text) ? 'parent' : 'child' }, el('span', { class: 'text' }, text));
        list.appendChild(li);
      }
      body.appendChild(list);
    } else if (view === 'Board') {
      const board = el('div', { class: 'board' });
      for (const parent of ['Prepare the site', 'Plant the beds', 'Find helpers']) {
        const cards = DEMO_LIST.filter(([t]) => NEST_PARENTS.has(t) ? false : isChildOf(t, parent));
        const column = el('div', { class: 'board-column' },
          el('h3', null, parent),
          el('div', { class: 'count' }, `${cards.length} cards`),
          el('ul', { class: 'cards' }, ...cards.map(([t]) => el('li', { class: 'board-card' }, t))),
        );
        board.appendChild(column);
      }
      body.appendChild(board);
    } else if (view === 'Tasks') {
      const list = el('ul', { class: 'demo-list' });
      for (const [text] of DEMO_LIST) {
        if (NEST_PARENTS.has(text)) {
          list.appendChild(el('li', { class: 'parent' }, el('span', { class: 'text' }, text)));
        } else {
          const li = el('li', { class: 'child' });
          const box = el('input', { type: 'checkbox', 'aria-label': text });
          li.appendChild(box);
          li.appendChild(el('span', { class: 'text' }, text));
          list.appendChild(li);
        }
      }
      body.appendChild(list);
    } else {
      const pre = el('pre', { style: 'font-family:var(--font-row);margin:0;white-space:pre-wrap' });
      const lines = DEMO_LIST.map(([text]) => (NEST_PARENTS.has(text) ? `- ${text}` : `  - ${text}`));
      pre.textContent = lines.join('\n');
      body.appendChild(pre);
    }
    tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String(i === index)));
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      active = index;
      render(active);
    });
  });
  nextButton.addEventListener('click', () => {
    active = (active + 1) % tabs.length;
    render(active);
  });
  render(0);
}

function isChildOf(text: string, parent: string): boolean {
  const groups: Record<string, string[]> = {
    'Prepare the site': ['Clear the lot', 'Test the soil'],
    'Plant the beds': ['Tomatoes', 'Herb spiral'],
    'Find helpers': ['Saturday crew'],
  };
  return (groups[parent] ?? []).includes(text);
}

function quoteSection(): HTMLElement {
  const quotes: [string, string][] = [
    ['I keep the whole allotment plan in one list and zoom into this week’s jobs.', 'Ines Varga, allotment secretary'],
    ['Chapters, scenes and beats, nested the way I actually think.', 'Tomasz Lind, novelist'],
    ['I shared one branch with my lab partner and nothing else.', 'Priya Nandakumar, student'],
  ];
  return el('section', { class: 'band' },
    el('div', { class: 'page' },
      el('div', { class: 'quotes' },
        ...quotes.map(([quote, name]) =>
          el('div', { class: 'quote-card' },
            el('blockquote', null, `“${quote}”`),
            el('cite', null, name),
          ),
        ),
      ),
    ),
  );
}

function roleSection(): HTMLElement {
  return el('section', { class: 'page', id: 'roles', style: 'padding:64px 24px' },
    el('div', { class: 'roles' },
      roleCard('Outline owner', ['Write, zoom, mirror and share any branch', 'Undo from every tab', 'Download as plain text, Markdown or OPML']),
      roleCard('Collaborator', ['Edit only the branch you were invited to', 'See the owner’s edits live', 'Download that branch']),
    ),
    el('div', { class: 'callout' },
      el('span', null, 'Press Alt and an arrow key to zoom into or out of any bullet.'),
      el('a', { href: '#keys' }, 'See every key →'),
    ),
  );
}

function roleCard(title: string, points: string[]): HTMLElement {
  return el('div', { class: 'role-card' },
    el('h3', null, title),
    el('ul', null, ...points.map((p) => el('li', null, p))),
    el('a', { href: '/signup', class: 'pill', 'data-name': 'Start your outline' }, 'Start your outline'),
  );
}

function downloadSection(): HTMLElement {
  const tiles: [string, string, string][] = [
    ['Plain text', 'Indentation and dashes, ready for anywhere.', '.txt'],
    ['Markdown', 'Nested lists with completion markers.', '.md'],
    ['OPML', 'Structured outlines for other outliners.', '.opml'],
  ];
  return el('section', { class: 'band', id: 'downloads' },
    el('div', { class: 'page' },
      el('div', { class: 'tiles' },
        ...tiles.map(([title, blurb]) =>
          el('div', { class: 'tile' },
            el('div', null, icon('download')),
            el('h3', null, title),
            el('p', null, blurb),
          ),
        ),
      ),
    ),
  );
}

function closingBlock(): HTMLElement {
  return el('section', { class: 'closing page' },
    el('h2', null, 'Your next plan already has branches.'),
    el('p', null, 'Start one outline, keep it for years, share exactly one branch.'),
    el('div', { class: 'pills' },
      el('a', { href: '/signup', class: 'pill', 'data-name': 'Start your outline' }, 'Start your outline'),
      el('a', { href: '/signin', class: 'pill pill-outline', 'data-name': 'Sign in with email' }, icon('at'), 'Sign in with email'),
    ),
  );
}

function footer(): HTMLElement {
  const columns: [string, string[]][] = [
    ['Twigline', ['Think in branches', 'Zoom any branch', 'Mirror bullets', 'Share one branch']],
    ['Outlining', ['Keyboard building', 'Branch focus', 'Search operators', 'Undo everywhere']],
    ['Sharing', ['Invite by email', 'Branch-only access', 'Live co-editing', 'Remove access']],
    ['Downloads', ['Plain text', 'Markdown', 'OPML']],
    ['Pellwick & Ash', ['About', 'Contact', 'Privacy', 'Terms']],
  ];
  return el('footer', { class: 'footer' },
    el('div', { class: 'page' },
      el('div', { class: 'footer-grid' },
        ...columns.map(([title, links]) =>
          el('div', null,
            el('h4', null, title),
            el('ul', null, ...links.map((link) => el('li', null, el('a', { href: '#features' }, link)))),
          ),
        ),
      ),
      el('div', { class: 'fine' }, '© Pellwick & Ash. Twigline keeps one outline per person, shared branch by branch.'),
    ),
  );
}
