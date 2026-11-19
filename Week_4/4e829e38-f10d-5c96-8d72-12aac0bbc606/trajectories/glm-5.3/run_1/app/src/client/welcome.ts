import { h, clear, announce, api } from './dom';
import { toastHost } from './dom';

export interface ChipDef { id: string; label: string; }

/** The team-kind chips of the welcome page, per the published copy. */
export const TEAM_KINDS: ChipDef[] = [
  { id: 'office', label: 'Office ops' },
  { id: 'content', label: 'Content' },
  { id: 'client', label: 'Client work' },
  { id: 'facilities', label: 'Facilities' },
  { id: 'finance', label: 'Finance close' },
  { id: 'studio', label: 'Studio' },
];

export interface KindCopy { heading: string; line: string; }

export const KIND_COPY: Record<string, KindCopy> = {
  office: { heading: 'Month-end close that starts itself', line: 'Checklists repeat on the right day and every sign-off is recorded.' },
  content: { heading: 'Every issue moves on its own schedule', line: 'Briefs, drafts and reviews repeat each cycle and rules hand them on.' },
  client: { heading: 'Requests become tracked jobs', line: 'A public form turns each request into a task with a named approver.' },
  facilities: { heading: 'Upkeep that never lapses', line: 'Machine and building checks come back every week or month.' },
  finance: { heading: 'Approvals with a clear paper trail', line: 'Each decision is saved with who agreed and when.' },
  studio: { heading: 'A balanced week for every person', line: 'Daily workload shows who is over capacity before a deadline slips.' },
};

const MEGA_MENUS: { id: string; label: string; cols: { title: string; links: string[] }[] }[] = [
  { id: 'work', label: 'Work', cols: [
    { title: 'Projects', links: ['Weekly orders', 'Machine upkeep', 'Stock takes'] },
    { title: 'Views', links: ['List', 'Board', 'Timeline'] },
    { title: 'Routines', links: ['Recurring tasks', 'Rules', 'Approvals'] },
  ] },
  { id: 'teams', label: 'Teams', cols: [
    { title: 'People', links: ['Members', 'Coordinators', 'Approvers'] },
    { title: 'Workload', links: ['Daily capacity', 'Reassign work'] },
    { title: 'Inbox', links: ['Approvals', 'Notices'] },
  ] },
  { id: 'learn', label: 'Learn', cols: [
    { title: 'Basics', links: ['Build the week', 'Watch a rule fire'] },
    { title: 'Guides', links: ['Goals and rollup', 'Requests to decisions'] },
    { title: 'Recipes', links: ['Ready to review', 'Owner flags'] },
  ] },
];

export function renderWelcome(root: HTMLElement): void {
  clear(root);
  const bar = h('header', { class: 'topbar' });
  const mark = h('span', { class: 'logomark', 'aria-hidden': 'true' });
  mark.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="9" cy="13" r="6.5" stroke="#e2554a" stroke-width="2.5"/><circle cx="17" cy="13" r="6.5" stroke="#17181a" stroke-width="2.5"/></svg>`;
  bar.append(h('a', { class: 'wordmark', href: '/' }, mark, 'Everyweek'), h('span', { class: 'spacer' }));

  for (const menu of MEGA_MENUS) {
    const wrap = h('div', { class: 'megamenu' });
    const btn = h('button', { class: 'pill quiet', 'aria-expanded': 'false', 'aria-controls': `mega-${menu.id}` },
      menu.label, h('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'));
    const panel = h('div', { class: 'megapanel', id: `mega-${menu.id}`, hidden: true });
    for (const col of menu.cols) {
      panel.append(h('div', { class: 'col' }, h('h3', {}, col.title),
        ...col.links.map(l => h('a', { href: '/#sample', onclick: (e: Event) => { e.preventDefault(); } }, l))));
    }
    const setOpen = (open: boolean): void => {
      btn.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
    };
    btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));
    btn.addEventListener('keydown', e => {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        e.preventDefault();
        setOpen(false);
        btn.focus();
      }
    });
    wrap.append(btn, panel);
    bar.append(wrap);
  }
  bar.append(
    h('a', { class: 'navlink', href: '/account' }, 'Log in'),
    h('a', { class: 'pill outline', href: '/f/supply-request' }, 'Try the sample form'),
    h('a', { class: 'pill primary', href: '/account' }, 'Get started'),
  );
  root.append(bar);

  const hero = h('section', { class: 'hero' },
    h('h1', {}, 'Recurring work that runs itself'),
    h('p', { class: 'sub' }, 'Corran & Bly Everyweek keeps the same routines going: tasks repeat on their own, requests become tracked jobs and every sign-off is recorded.'),
  );
  const chips = h('div', { class: 'kinds', role: 'tablist', 'aria-label': 'Team kinds' });
  for (const k of TEAM_KINDS) {
    const chip = h('button', {
      class: 'chip', role: 'tab', 'aria-selected': k.id === 'office' ? 'true' : 'false',
      onclick: () => pickKind(k.id),
    }, k.label);
    chips.append(chip);
  }
  hero.append(chips);
  const panel = h('div', { role: 'tabpanel' });
  hero.append(panel);

  const pickKind = (id: string): void => {
    chips.querySelectorAll<HTMLElement>('[role="tab"]').forEach(c => c.setAttribute('aria-selected', String(c === document.activeElement)));
    chips.querySelectorAll<HTMLElement>('[role="tab"]').forEach(c => c.setAttribute('aria-selected', 'false'));
    const idx = TEAM_KINDS.findIndex(k => k.id === id);
    (chips.children[idx] as HTMLElement).setAttribute('aria-selected', 'true');
    clear(panel);
    panel.append(h('h2', {}, KIND_COPY[id].heading), h('p', { class: 'sub' }, KIND_COPY[id].line));
  };
  pickKind('office');
  root.append(hero);

  const two = h('section', { class: 'two-col cols-2' });
  const copy = h('div', { class: 'stack' },
    h('h2', {}, 'One place for the week'),
    h('p', { class: 'muted' }, 'Build the week once. Sections, fields and rules carry it forward, and your team sees every change in place.'),
    h('div', { class: 'signupblock' },
      h('div', { class: 'pills' },
        h('button', { class: 'pill outline', onclick: () => { window.location.href = '/account?mode=join'; } }, 'Join with a team code'),
        h('button', { class: 'pill outline', onclick: () => { window.location.href = '/f/supply-request'; } }, 'Open a sample request form')),
      h('div', { class: 'or' }, 'or'),
      (() => {
        const email = h('input', { class: 'fieldinput', id: 'work-email', name: 'work email', type: 'email', placeholder: 'name@example.com' }) as HTMLInputElement;
        email.setAttribute('aria-label', 'Work email');
        email.style.minHeight = '44px';
        email.style.border = '1.5px solid var(--line-2)';
        email.style.borderRadius = '999px';
        email.style.padding = '0 16px';
        const go = h('button', { class: 'pill primary', onclick: () => { window.location.href = `/account?email=${encodeURIComponent(email.value)}`; } }, 'Sign up');
        return h('div', { class: 'row' }, email, go);
      })(),
    ));
  const collage = h('div', { class: 'collage', 'aria-label': 'Recurring work collage' });
  drawCollage(collage, 'office');
  two.append(collage, copy);
  root.append(two);

  const showcase = h('section', { class: 'darkband showcase' });
  showcase.append(h('h2', { style: 'text-align:center' }, 'See it working'));
  const tabs = h('div', { class: 'showcase-tabs', role: 'tablist', 'aria-label': 'Showcase views' });
  const carousel = h('div', { class: 'carousel' });
  const SHOW = [
    { id: 'list', title: 'List', icon: '☰', line: 'Sections with keyboard entry and instant teammates edits.' },
    { id: 'board', title: 'Board', icon: '▦', line: 'Cards move by keyboard or touch with live positions.' },
    { id: 'timeline', title: 'Timeline', icon: '▬', line: 'Bars shift by a day and link blockers to waiting work.' },
    { id: 'workload', title: 'Workload', icon: '◫', line: 'Daily effort against capacity flags the Fridays that spill.' },
    { id: 'rules', title: 'Rules', icon: '⚙', line: 'Triggers, conditions and actions chain to the depth limit.' },
  ];
  SHOW.forEach((s, i) => {
    tabs.append(h('button', { class: 'chip', role: 'tab', 'aria-selected': String(i === 0), onclick: () => pickShow(i) }, s.title));
  });
  const pickShow = (i: number): void => {
    tabs.querySelectorAll<HTMLElement>('[role="tab"]').forEach((c, j) => c.setAttribute('aria-selected', String(j === i)));
    Array.from(carousel.children).forEach((c, j) => {
      (c as HTMLElement).classList.toggle('dim', j !== i);
      (c as HTMLElement).scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
    });
    carousel.querySelectorAll('.dots span').forEach((d, j) => d.classList.toggle('on', j === i));
  };
  const cards = SHOW.map(s => h('div', { class: 'card showcard' },
    h('div', { class: 'icon-tile', 'aria-hidden': 'true' }, s.icon),
    h('h3', {}, s.title),
    h('p', { class: 'muted' }, s.line),
    h('div', { class: 'mock', 'aria-hidden': 'true' })));
  cards.forEach(c => carousel.append(c));
  const dots = h('div', { class: 'dots' }, ...SHOW.map((_, i) => h('span', { class: i === 0 ? 'on' : '' })));
  showcase.append(tabs, carousel, dots);
  root.append(showcase);
  pickShow(0);

  const prev = h('button', { class: 'roundbtn', 'aria-label': 'Previous', onclick: () => pickShowWrap(-1) }, '‹');
  const next = h('button', { class: 'roundbtn', 'aria-label': 'Next', onclick: () => pickShowWrap(1) }, '›');
  let showIdx = 0;
  const pickShowWrap = (d: number): void => {
    showIdx = (showIdx + d + SHOW.length) % SHOW.length;
    pickShow(showIdx);
  };
  showcase.append(h('div', { class: 'row', style: 'justify-content:center;gap:12px' }, prev, next));

  const story = h('section', { class: 'story' },
    h('div', { class: 'quotewrap' },
      h('blockquote', {}, '“I stopped rebuilding Mondays. The repeat rules start the week and I just keep an eye on it.”'),
      h('div', { class: 'who' }, 'Ilse Marchetti — kitchen lead, Larder Street Kitchen')),
    h('div', {},
      h('h2', {}, 'Made for the crew that repeats'),
      h('p', { class: 'muted' }, 'A community kitchen, a makerspace, a small office close: the same jobs, the same week, without somebody copying rows by hand.')));
  root.append(story);

  const band = h('section', { class: 'darkband startband' },
    h('h2', {}, 'Start your workspace'),
    h('a', { class: 'pill', style: 'background:var(--paper);color:var(--ink)', href: '/account' }, 'Get started'),
    h('div', { class: 'foot' }, 'Corran & Bly Everyweek is an invented product for small teams. Its font is Instrument Sans.'));
  root.append(band);

  const footer = h('footer', { class: 'footer' });
  const cols = [
    { title: 'Product', links: ['Views', 'Rules', 'Goals', 'Workload'] },
    { title: 'Teams', links: ['Members', 'Coordinators', 'Approvers'] },
    { title: 'Routines', links: ['Repeats', 'Approvals', 'Requests'] },
    { title: 'Guides', links: ['Build the week', 'Watch a rule fire', 'Two people, one task'] },
    { title: 'About', links: ['Corran & Bly', 'Instrument Sans', 'Contact'] },
  ];
  const fcols = h('div', { class: 'cols' });
  for (const c of cols) fcols.append(h('div', {}, h('h3', {}, c.title), ...c.links.map(l => h('a', { href: '/#sample', onclick: (e: Event) => { e.preventDefault(); } }, l))));
  const top = h('button', { class: 'roundbtn', 'aria-label': 'Back to top', onclick: () => window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }) }, '↑');
  footer.append(fcols, h('div', { class: 'bottom' }, h('span', {}, '© 2026 Corran & Bly. Everyweek is invented.'), top));
  root.append(footer);
}

function reduced(): boolean { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

function drawCollage(host: HTMLElement, kind: string): void {
  clear(host);
  const trail = h('div', { class: 'trail' });
  trail.innerHTML = `<svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 480 340">
    <path d="M60 250 C 120 190, 180 200, 240 150 S 340 70, 420 90" stroke="#f6b8ac" stroke-width="2" fill="none"/>
    <path d="M240 150 C 300 120, 340 70, 420 90" stroke="#e2554a" stroke-width="2" fill="none"/>
    <circle cx="60" cy="250" r="4" fill="#17181a"/>
    <circle cx="240" cy="150" r="4" fill="#17181a"/>
    <circle cx="420" cy="90" r="4" fill="#17181a"/>
  </svg>`;
  host.append(trail);
  const bits = [
    { x: 12, y: 210, label: 'Weigh stock — repeats Monday' },
    { x: 176, y: 108, label: 'Request REQ-0001' },
    { x: 330, y: 48, label: 'Approved' },
    { x: 330, y: 250, label: 'NJ + IM' },
  ];
  for (const b of bits) {
    host.append(h('div', { class: 'bit', style: `left:${b.x}px;top:${b.y}px` }, b.label));
  }
  void kind;
}

export async function signOut(): Promise<void> {
  await api('POST', '/api/signout', {});
  window.location.href = '/';
}

export function notifySaved(): void {
  toastHost().show('Saved');
  announce('Notifications', 'Saved');
}
