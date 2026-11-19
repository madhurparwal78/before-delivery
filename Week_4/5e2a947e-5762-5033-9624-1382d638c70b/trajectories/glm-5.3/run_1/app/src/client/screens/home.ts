import { el } from '../lib/dom.js';
import { api } from '../lib/api.js';

/**
 * The home page: shrinking top bar, home branch field drawn by the
 * app's own layout engine, product statement line, feature splits
 * with checklists, and the site footer.
 */

import { layoutMap } from '../../shared/layout.js';

const SAMPLE_ROOT = {
  id: 'r', parent_id: null, rank: 0, floating: false, x: null, y: null,
  title: 'Plan together', note: '', icon: null, colour: null, shape: null, side_pin: null,
  task: null, locked_by: null, lock_inherited: false, restricted: false,
  attachments: [], comment_count: 0, vote_count: 0, voted: false,
};

interface SampleTopic {
  id: string; parent_id: string | null; rank: number; floating: boolean; x: number | null; y: number | null;
  title: string; note: string; icon: null; colour: null; shape: null; side_pin: null;
  task: null; locked_by: null; lock_inherited: boolean; restricted: boolean;
  attachments: never[]; comment_count: number; vote_count: number; voted: boolean;
}

function sampleMap(): SampleTopic[] {
  const mk = (id: string, rank: number, title: string): SampleTopic => ({
    ...SAMPLE_ROOT, id, parent_id: 'r', rank, title,
  });
  return [
    SAMPLE_ROOT,
    mk('a', 0, 'Ideas'),
    mk('b', 1, 'Drafts'),
    mk('c', 2, 'Reviews'),
    mk('d', 3, 'Budgets'),
    mk('e', 4, 'Timelines'),
    mk('f', 5, 'Guests'),
    mk('g', 6, 'Notes'),
    mk('h', 7, 'Presents'),
  ];
}

export function renderHome(root: HTMLElement): void {
  root.replaceChildren();
  const topbar = el('header', { class: 'topbar' });
  const brand = el('a', { class: 'brand', href: '/' }, 'Sprigmap');
  const nav = el('nav', {});
  nav.append(
    el('a', { href: '/signin', role: 'link', 'aria-label': 'Sign in' }, 'Sign in'),
    el('a', { href: '/signup', role: 'link', 'aria-label': 'Get started' }, 'Get started'),
  );
  topbar.append(brand, nav);
  root.appendChild(topbar);

  // The ribbons are the connectors of a real sample map with eight level 2 topics.
  const hero = el('section', { class: 'hero', 'aria-label': 'Branch field' });
  const ribbons = el('div', { class: 'hero-ribbons', 'aria-hidden': 'true' });
  const topics = sampleMap();
  const layout = layoutMap(topics, 'map', new Set());
  const svgns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgns, 'svg');
  svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;');
  for (const t of topics.slice(1)) {
    const box = layout.boxes.get(t.id);
    if (!box) continue;
    const path = document.createElementNS(svgns, 'path');
    path.setAttribute('d', `M 0 0 C ${(box.x / 2).toFixed(0)} ${(box.y / 2).toFixed(0)}, ${box.x.toFixed(0)} ${(box.y / 2).toFixed(0)}, ${box.x.toFixed(0)} ${box.y.toFixed(0)}`);
    path.setAttribute('stroke', ['indigo', 'azure', 'teal', 'green', 'violet', 'magenta', 'orange', 'ochre'][(t.rank) % 8]);
    path.setAttribute('stroke-width', '10');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('opacity', '0.18');
    path.classList.add('ribbon');
    svg.appendChild(path);
  }
  ribbons.appendChild(svg);
  const stack = el('div', { class: 'hero-stack' });
  const eyebrow = el('p', { class: 'hero-eyebrow' }, 'Real-time collaborative mind maps');
  const heading = el('h1', { class: 'hero-heading' }, 'Grow one idea into a plan, together');
  const arrow = el('div', { class: 'hero-arrow', 'aria-hidden': 'true' }, '→');
  const cta = el('div', { class: 'hero-cta' });
  const getStarted = el('button', { class: 'primary' }, 'Get started');
  getStarted.addEventListener('click', () => { location.href = '/signup'; });
  cta.appendChild(getStarted);
  const avatars = el('div', { class: 'hero-avatars', 'aria-hidden': 'true' });
  avatars.append(el('span', { class: 'avatar' }, 'SD'), el('span', { class: 'avatar' }, 'JT'), el('span', { class: 'avatar' }, 'MR'));
  stack.append(eyebrow, heading, arrow, cta, avatars);
  hero.append(ribbons, stack);
  root.appendChild(hero);

  const statement = el('p', { class: 'statement' },
    'Sprigmap keeps a whole team on one map: live cursors, one undo each and an outline that travels intact.');
  root.appendChild(statement);

  const features: { title: string; body: string; items: string[] }[] = [
    { title: 'Edit together without tangles', body: 'Every change lands in one order, conflicts are visible and nothing is quietly lost.', items: ['Live cursors and selections', 'Conflicts announced with a published rule', 'One undo each'] },
    { title: 'Keep the whole picture', body: 'History replays, versions compare and restore without ever losing the thread.', items: ['Playback slider over every version', 'Diffs by topic id', 'Restore as one undoable change'] },
    { title: 'Take it anywhere', body: 'Work offline on a train, present from a link, export in the plain-text Sprig format.', items: ['Offline queue that survives reload', 'Audience view on a phone', 'Byte-exact Sprig outline'] },
  ];
  features.forEach((f, i) => {
    const split = el('section', { class: `feature-split ${i % 2 === 1 ? 'reverse' : ''}` });
    const copy = el('div', { class: 'feature-copy' });
    copy.append(el('h2', {}, f.title), el('p', {}, f.body));
    const list = el('ul', { class: 'checklist' });
    for (const item of f.items) list.appendChild(el('li', {}, item));
    copy.appendChild(list);
    const panel = el('div', { class: 'feature-panel' });
    const mini = renderMini();
    panel.appendChild(mini);
    split.append(copy, panel);
    root.appendChild(split);
  });

  const footer = el('footer', { class: 'site-footer' });
  const columns = el('div', { class: 'footer-columns' });
  const col = (title: string, links: string[]): HTMLElement => {
    const c = el('div', { class: 'footer-col' });
    c.appendChild(el('h3', {}, title));
    const ul = el('ul', {});
    for (const l of links) ul.appendChild(el('li', {}, l));
    c.appendChild(ul);
    return c;
  };
  columns.append(col('Product', ['Maps', 'Outline', 'Present']), col('Company', ['About', 'Careers']), col('Help', ['Guide', 'Format']));
  footer.appendChild(columns);
  root.appendChild(footer);

  // The shrinking top bar.
  window.addEventListener('scroll', () => {
    topbar.classList.toggle('compact', window.scrollY > 8);
  }, { passive: true });
}

/** A live map canvas in miniature: a real read-only rendering. */
function renderMini(): HTMLElement {
  const wrap = el('div', { class: 'mini', style: 'position:relative;width:100%;height:240px;' });
  const svgns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgns, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', '-620 -220 1240 440');
  const topics = sampleMap();
  const layout = layoutMap(topics, 'map', new Set());
  for (const t of topics) {
    const box = layout.boxes.get(t.id);
    if (!box) continue;
    const g = document.createElementNS(svgns, 'g');
    g.setAttribute('transform', `translate(${box.x - box.w / 2} ${box.y - box.h / 2})`);
    const rect = document.createElementNS(svgns, 'rect');
    rect.setAttribute('width', String(box.w));
    rect.setAttribute('height', String(box.h));
    rect.setAttribute('rx', '12');
    rect.setAttribute('fill', t.id === 'r' ? '#2b4ef2' : '#ffffff');
    rect.setAttribute('stroke', t.id === 'r' ? '#2b4ef2' : '#2b4ef2');
    rect.setAttribute('stroke-width', '3');
    const text = document.createElementNS(svgns, 'text');
    text.setAttribute('x', String(box.w / 2));
    text.setAttribute('y', String(box.h / 2 + 5));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '13');
    text.setAttribute('fill', t.id === 'r' ? '#ffffff' : '#241b33');
    text.textContent = t.title;
    g.append(rect, text);
    svg.appendChild(g);
  }
  for (const t of topics) {
    if (!t.parent_id) continue;
    const cb = layout.boxes.get(t.id)!;
    const pb = layout.boxes.get(t.parent_id)!;
    const path = document.createElementNS(svgns, 'path');
    path.setAttribute('d', `M ${pb.x} ${pb.y} C ${(cb.x + pb.x) / 2} ${pb.y}, ${(cb.x + pb.x) / 2} ${cb.y}, ${cb.x} ${cb.y}`);
    path.setAttribute('stroke', '#b9b3c9');
    path.setAttribute('stroke-width', '4');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
  }
  wrap.appendChild(svg);
  return wrap;
}

export async function checkSession(): Promise<{ username: string } | null> {
  const out = await api<{ user: { username: string } }>('/api/me');
  return out.ok ? (out.body as { user: { username: string } }).user : null;
}
