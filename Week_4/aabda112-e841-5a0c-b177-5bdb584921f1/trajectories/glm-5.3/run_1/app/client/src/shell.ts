import { el, openDialog, trapFocus } from './ui.js';
import { ROLE_LABELS } from './api.js';
import { announcer } from './live.js';

export type Me = {
  id: string;
  name: string;
  role: string;
  clinic: { id: string; name: string; slug: string };
};

// ---------- header ----------

export function renderHeader(me: Me, currentPath: string, navigate: (p: string) => void): HTMLElement {
  const bar = el('header', { class: 'topbar', role: 'banner' });
  const home = el('a', { class: 'home-link', href: '/today' }, 'Roundbook home');
  bar.append(home);

  const navLinks: { label: string; path: string; roles: string[] }[] = [
    { label: 'Today', path: '/today', roles: ['front-desk', 'nurse', 'vet', 'manager'] },
    { label: 'Ward', path: '/ward', roles: ['front-desk', 'nurse', 'vet', 'manager'] },
    { label: 'Patients', path: '/patients', roles: ['front-desk', 'nurse', 'vet', 'manager'] },
    { label: 'Invoices', path: '/invoices', roles: ['front-desk', 'vet', 'manager'] },
  ];
  const visibleLinks = navLinks.filter((l) => l.roles.includes(me.role));

  const nav = el('nav', { 'aria-label': 'Clinic sections', class: 'inline-links' });
  for (const link of visibleLinks) {
    const a = el('a', { href: link.path, 'aria-current': currentPath === link.path ? 'page' : null }, link.label);
    nav.append(a);
  }
  bar.append(nav);

  // Manage menu (all roles see it; items depend on role)
  const manageWrap = el('div', { style: 'position:relative;display:inline-flex' });
  const manageBtn = el('button', {
    class: 'btn',
    'aria-expanded': 'false',
    'aria-haspopup': 'true',
    onclick: () => {
      const expanded = manageBtn.getAttribute('aria-expanded') === 'true';
      manageBtn.setAttribute('aria-expanded', String(!expanded));
      panel.style.display = expanded ? 'none' : 'grid';
      if (!expanded) {
        const first = panel.querySelector('a');
        first?.focus();
      }
    },
  }, 'Manage');
  const panel = el('div', { class: 'manage-panel', role: 'menu', style: 'display:none' });
  const items: { label: string; path: string; roles: string[] }[] = [
    { label: 'Stock', path: '/stock', roles: ['front-desk', 'nurse', 'vet', 'manager'] },
    { label: 'Staff', path: '/staff', roles: ['manager'] },
  ];
  for (const item of items.filter((i) => i.roles.includes(me.role))) {
    panel.append(el('a', { role: 'menuitem', href: item.path }, item.label));
  }
  manageWrap.append(manageBtn, panel);
  const closePanel = () => {
    manageBtn.setAttribute('aria-expanded', 'false');
    panel.style.display = 'none';
    manageBtn.focus();
  };
  manageWrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePanel();
    }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePanel();
    }
  });
  if (me.role !== 'manager') {
    // non-managers still get Stock; Staff is absent
  }
  bar.append(manageWrap);
  bar.append(el('span', { class: 'spacer' }));

  const who = el('span', { class: 'who' }, `${me.name}, ${ROLE_LABELS[me.role]}`);
  bar.append(who);
  const todayBtn = el('a', { class: 'pill pill-primary', href: '/today' }, 'Go to today');
  bar.append(todayBtn);
  const signOut = el('button', {
    class: 'btn',
    onclick: async () => {
      await fetch('/api/session', { method: 'DELETE' });
      window.location.href = '/login';
    },
  }, 'Sign out');
  bar.append(signOut);

  // 375px drawer: everything except home and Open menu
  const openMenu = el('button', {
    class: 'round-btn',
    'aria-label': 'Open menu',
    'aria-haspopup': 'dialog',
    onclick: () => openDrawer(),
  }, '☰');
  bar.append(openMenu);

  function openDrawer(): void {
    const dlg = document.createElement('dialog');
    dlg.className = 'rb-dialog';
    dlg.setAttribute('aria-label', 'Menu');
    const body = el('div', { class: 'dialog-body' });
    body.append(el('h2', { text: 'Menu' }));
    const add = (label: string, path: string) => {
      body.append(el('a', { href: path, style: 'min-height:44px;display:flex;align-items:center;color:#0f7a58;text-decoration:none;font-weight:500' }, label));
    };
    for (const link of visibleLinks) add(link.label, link.path);
    if (me.role === 'manager') add('Staff', '/staff');
    add('Stock', '/stock');
    body.append(el('a', { href: '/today', style: 'min-height:44px;display:flex;align-items:center;color:#0f7a58;text-decoration:none;font-weight:500' }, 'Go to today'));
    const closeBtn = el('button', { class: 'pill pill-primary', onclick: () => dlg.close() }, 'Close menu');
    body.append(closeBtn);
    const signOut2 = el('button', {
      class: 'btn',
      onclick: async () => {
        await fetch('/api/session', { method: 'DELETE' });
        window.location.href = '/login';
      },
    }, 'Sign out');
    body.append(signOut2);
    dlg.append(body);
    document.body.append(dlg);
    dlg.showModal();
    closeBtn.focus();
    trapFocus(dlg, () => dlg.close());
    dlg.addEventListener('close', () => {
      dlg.remove();
      openMenu.focus();
    });
  }

  return bar;
}

// ---------- footer ----------

export function renderFooter(me: Me | null, clinicSlug: string): HTMLElement {
  const footer = el('footer', { class: 'site-footer', role: 'contentinfo' });
  const nav = el('nav', { 'aria-label': 'Workspace links' });
  const grid = el('div', { class: 'footer-grid' });
  const columns: { heading: string; links: { label: string; href: string }[] }[] = [
    { heading: 'Front desk', links: [{ label: 'Day view', href: '/today' }, { label: 'Online booking', href: `/book/${clinicSlug}` }] },
    { heading: 'Clinical', links: [{ label: 'Kennel round', href: '/ward' }, { label: 'Animal records', href: '/patients' }] },
    {
      heading: 'Money and supplies',
      links: me && ['front-desk', 'vet', 'manager'].includes(me.role)
        ? [{ label: 'Billing', href: '/invoices' }, { label: 'Supplies', href: '/stock' }]
        : [{ label: 'Supplies', href: '/stock' }],
    },
    { heading: 'Practice', links: me?.role === 'manager' ? [{ label: 'Team access', href: '/staff' }] : [] },
  ];
  for (const col of columns) {
    if (col.links.length === 0) continue;
    const ul = el('ul');
    for (const link of col.links) {
      ul.append(el('li', {}, el('a', { href: link.href }, link.label)));
    }
    grid.append(el('section', {}, el('h3', { text: col.heading }), ul));
  }
  nav.append(grid);
  footer.append(nav, el('p', { class: 'footer-tag' }, 'Roundbook by Larchmere Veterinary Systems'));
  return footer;
}

// ---------- split band ----------

export function renderSplitBand(headline: string, right: Node | null, actions: Node[] = []): HTMLElement {
  const band = el('section', { class: 'split-band' });
  const left = el('div', { class: 'band-left' });
  left.append(el('h1', { class: 'screen-headline', text: headline }));
  if (actions.length > 0) {
    const row = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' });
    for (const a of actions) row.append(a);
    left.append(row);
  }
  const rightPanel = el('div', { class: 'band-right' });
  if (right) rightPanel.append(right);
  const strip = el('div', { class: 'strip' }, el('span', { class: 'a' }), el('span', { class: 'b' }));
  band.append(left, rightPanel, strip);
  return band;
}

// ---------- Kennel beacon ----------

type BeaconState = { seen: boolean; value: number };

export function renderBeacons(getBeacons: () => { waiting: number; overdue: number; dueWithinHour: number }): {
  root: HTMLElement; update: (b: { waiting: number; overdue: number; dueWithinHour: number }) => void;
} {
  const root = el('div', { class: 'beacons' });
  const kinds: { key: string; label: string }[] = [
    { key: 'waiting', label: 'Waiting' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'dueWithinHour', label: 'Due within the hour' },
  ];
  const states: Record<string, BeaconState> = {};
  const cards: Record<string, HTMLElement> = {};
  let firstView = true;

  const buildCard = (kind: string, label: string): HTMLElement => {
    const state: BeaconState = { seen: false, value: 0 };
    states[kind] = state;
    const card = el('div', {
      class: 'beacon',
      'data-kind': kind === 'dueWithinHour' ? 'due-within-hour' : kind,
      'data-motion': 'idle',
      'data-motion-ms': '0',
      'data-motion-easing': '0.16, 1, 0.3, 1',
      role: 'status',
      'aria-label': label,
    });
    const digits = el('span', { class: 'digits', 'aria-hidden': 'true' });
    const hidden = el('span', { class: 'visually-hidden' });
    const caption = el('span', { class: 'caption', text: label });
    card.append(digits, hidden, caption);
    (card as any)._digitsEl = digits;
    (card as any)._hiddenEl = hidden;
    cards[kind] = card;
    return card;
  };

  for (const k of kinds) root.append(buildCard(k.key, k.label));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const setDigits = (card: HTMLElement, value: number, rolling: boolean) => {
    const digitsEl: HTMLElement = (card as any)._digitsEl;
    const hiddenEl: HTMLElement = (card as any)._hiddenEl;
    card.setAttribute('data-value', String(value));
    hiddenEl.textContent = String(value);
    const str = String(value);
    const before: string = (digitsEl as any)._last || '';
    (digitsEl as any)._last = str;
    digitsEl.textContent = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const changed = before[i] !== ch;
      const d = el('span', { class: 'digit', 'data-digit': ch });
      if (rolling && changed) d.setAttribute('data-rolling', 'true');
      digitsEl.append(d);
    }
  };

  let countTimers: number[] = [];

  const update = (b: { waiting: number; overdue: number; dueWithinHour: number }): void => {
    for (const timer of countTimers) window.clearTimeout(timer);
    countTimers = [];
    kinds.forEach((k, idx) => {
      const card = cards[k.key];
      const value = (b as any)[k.key];
      const state = states[k.key];
      if (!state.seen) {
        // first view: count from 0 to the total; cards start 150 ms apart
        state.seen = true;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) {
          setDigits(card, value, false);
          card.setAttribute('data-motion', 'none');
          card.setAttribute('data-motion-ms', '0');
          return;
        }
        const total = value;
        const duration = 1600;
        const start = performance.now() + idx * 150;
        card.setAttribute('data-motion', 'beacon-count');
        card.setAttribute('data-motion-ms', '1600');
        card.setAttribute('data-motion-easing', '0.16, 1, 0.3, 1');
        const tick = (now: number) => {
          const t = Math.min(1, Math.max(0, (now - start) / duration));
          const eased = 1 - Math.pow(1 - t, 3);
          setDigits(card, Math.round(total * eased), false);
          if (t < 1) {
            countTimers.push(window.requestAnimationFrame(tick) as unknown as number);
          } else {
            setDigits(card, total, false);
            const clear = window.setTimeout(() => {
              card.setAttribute('data-motion', 'idle');
            }, 1000);
            countTimers.push(clear);
          }
        };
        countTimers.push(window.requestAnimationFrame(tick) as unknown as number);
      } else {
        const prev = Number(card.getAttribute('data-value') || '0');
        if (prev === value) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) {
          setDigits(card, value, false);
          card.setAttribute('data-motion', 'none');
          card.setAttribute('data-motion-ms', '0');
          return;
        }
        card.setAttribute('data-motion', 'beacon-roll');
        card.setAttribute('data-motion-ms', '600');
        card.setAttribute('data-motion-easing', '0.16, 1, 0.3, 1');
        setDigits(card, value, true);
        const clear = window.setTimeout(() => {
          card.setAttribute('data-motion', 'idle');
          setDigits(card, value, false);
        }, 600);
        countTimers.push(clear);
      }
    });
  };

  return { root, update };
}
