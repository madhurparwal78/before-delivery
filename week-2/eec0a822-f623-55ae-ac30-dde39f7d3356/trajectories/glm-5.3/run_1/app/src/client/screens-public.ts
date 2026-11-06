import { api, ApiError, errorCopy } from './api.js';
import { h, qs, qsa, announce, openDialog, message, clearMessage, focusableIn } from './ui.js';
import { fmtDateOnly, fmtDateTime, fmtMoney, fmtMeasurement, localDate, addDays, isSaturday, weeksWindow } from '../shared/bases.js';

export const GONE_HEADING = 'This yacht isn\'t available';
export const GONE_BODY = 'It\'s been withdrawn from charter. Browse the fleet for yachts that are sailing.';
export const ENDED_HEADING = 'This link has ended';
export const ENDED_BODY = 'Links from Tidewright stop working after a set time or when a new one is sent. Ask your charter contact for a new link.';
export const NOTFOUND_HEADING = 'We couldn\'t find that page';
export const NOTFOUND_BODY = 'Check the address, or sign in to your workspace.';

export function pageShell(children: Node[], cls = 'public'): HTMLElement {
  const main = h('main', { class: `page ${cls}` }, ...children);
  const announcements = h('div', { 'aria-live': 'polite', 'data-announcements': '', class: 'visually-hidden', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' });
  return h('div', {}, main, announcements);
}

export function gonePage(): HTMLElement {
  return pageShell([
    h('div', { class: 'gone' },
      h('h1', {}, GONE_HEADING),
      h('p', {}, GONE_BODY),
      h('p', {}, h('a', { href: '/fleet/adriatic-sunline' }, 'Browse the fleet')),
    ),
  ]);
}

export function endedPage(wsSlug: string | null): HTMLElement {
  return pageShell([
    h('div', { class: 'ended' },
      h('h1', {}, ENDED_HEADING),
      h('p', {}, ENDED_BODY),
      wsSlug ? h('p', {}, h('a', { href: `/fleet/${wsSlug}` }, 'Browse the fleet')) : null,
    ),
  ]);
}

export function notFoundPage(): HTMLElement {
  return pageShell([
    h('div', { class: 'notfound' },
      h('h1', {}, NOTFOUND_HEADING),
      h('p', {}, NOTFOUND_BODY),
      h('p', {}, h('a', { href: '/sign-in' }, 'Sign in')),
    ),
  ]);
}

// ---------------- sign-in ----------------

export function signInScreen(returnTo: string | null): HTMLElement {
  const email = h('input', { type: 'email', id: 'email', name: 'email', autocomplete: 'email' });
  const password = h('input', { type: 'password', id: 'password', name: 'password', autocomplete: 'current-password' });
  const submit = h('button', { class: 'primary', type: 'submit' }, 'Sign in');
  const msgBox = h('div', {});
  const form = h('form', { novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), password),
    msgBox,
    submit,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Signing in';
    announce('Signing in');
    try {
      const res = await api<{ homePath: string }>('/api/session', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
      announce('Signed in');
      const target = returnTo && returnTo.startsWith('/') ? returnTo : res.homePath;
      location.href = target;
    } catch (err) {
      submit.disabled = false;
      submit.textContent = original;
      const copy = errorCopy(err as ApiError);
      message('err', copy.message, msgBox);
      announce(copy.message);
      email.focus();
      email.setAttribute('aria-invalid', 'true');
    }
  });
  return pageShell([
    h('div', { class: 'page narrow', style: 'min-height:60vh;display:flex;align-items:center' },
      h('div', { class: 'card', style: 'width:100%' },
        h('h1', {}, 'Sign in to Tidewright'),
        form,
      ),
    ),
  ], 'narrow');
}

// ---------------- public fleet ----------------

interface PublicYacht {
  slug: string;
  name: string;
  base: 'split' | 'lavrio';
  cabins: number;
  lengthM: number;
  beamM: number;
  draftM: number;
  rates: { lowMinor: number; shoulderMinor: number; highMinor: number };
  currency: string;
}

export function sunBadge(): HTMLElement {
  return h('img', {
    src: '/assets/sun.svg',
    alt: 'Solar-electric fleet',
    class: 'sunbadge',
    width: '44',
    height: '44',
  });
}

function hullDrawing(name: string, lengthM: number, beamM: number): HTMLElement {
  const scale = Math.max(40, Math.min(120, lengthM * 4));
  const height = Math.max(18, Math.min(46, beamM * 3));
  const w = scale;
  const hh = height;
  const svg = `<svg class="hull" width="${w}" height="${hh + 8}" viewBox="0 0 ${w} ${hh + 8}" role="img" aria-label="${name} hull drawing" focusable="false">
    <g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M2 ${hh * 0.45} H ${w - 2} L ${w - 8} ${hh * 0.75} Q ${w / 2} ${hh + 5} 8 ${hh * 0.75} Z"/>
      <path d="M${w * 0.25} ${hh * 0.45} V ${hh * 0.2} H ${w * 0.75} V ${hh * 0.45}"/>
      <path d="M${w * 0.35} ${hh * 0.2} V 2 M${w * 0.65} ${hh * 0.2} V 2"/>
      <path d="M${w * 0.35} 2 H ${w * 0.65}"/>
    </g>
  </svg>`;
  const wrap = h('span', { html: svg });
  return wrap;
}

export async function fleetScreen(ws: string): Promise<HTMLElement> {
  const params = new URLSearchParams(location.search);
  const state = {
    base: params.get('base') ?? '',
    cabins: params.get('cabins') ?? '',
    season: params.get('season') ?? '',
    week: params.get('week') ?? '',
    q: params.get('q') ?? '',
  };
  const search = h('input', { type: 'search', 'aria-label': 'Search yachts', placeholder: 'Search yachts', value: state.q });
  const list = h('ul', { 'aria-label': 'Yachts', class: 'cards-col', style: 'list-style:none;padding:0;display:contents' });
  const strip = h('div', { class: 'strip-wrap' }, h('div', { class: 'strip cards-col', tabindex: '0', 'aria-label': 'Yachts' }, list));
  const hairlineWrap = h('div', { class: 'progresshair', style: 'display:none' }, h('div', { class: 'hairline-track' }, h('div', { style: 'width: 0%' })));
  const heading = h('h1', {}, 'Fleet');
  const load = async () => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries({ base: state.base, cabins: state.cabins, season: state.season, week: state.week, q: state.q })) {
      if (v) query.set(k, v);
    }
    const data = await api<{ workspace: { slug: string; name: string }, yachts: PublicYacht[] }>(`/api/public/fleets/${ws}?${query}`);
    heading.textContent = `${data.workspace.name} fleet`;
    list.textContent = '';
    for (const y of data.yachts) {
      const rateLabel = state.season
        ? `${fmtMoney(y.rates[state.season === 'low' ? 'lowMinor' : state.season === 'shoulder' ? 'shoulderMinor' : 'highMinor'], 'EUR')} a week`
        : `From ${fmtMoney(y.rates.lowMinor, 'EUR')} a week`;
      list.append(h('li', { class: 'card' },
        hullDrawing(y.name, y.lengthM, y.beamM),
        h('p', {}, h('a', { href: `/fleet/${ws}/${y.slug}` }, y.name)),
        h('p', { class: 'num' }, `${y.base === 'split' ? 'Split' : 'Lavrio'} · ${y.cabins} cabins · ${fmtMeasurement(y.lengthM)}`),
        h('p', { class: 'num' }, rateLabel),
      ));
    }
    if (data.yachts.length === 0) {
      list.append(h('li', { class: 'empty' }, 'No yachts match.'));
    }
    positionHairline(data.yachts.length, 0);
    stripState.count = data.yachts.length;
    stripState.index = 0;
  };
  const stripState = { count: 0, index: 0 };
  const positionHairline = (count: number, index: number) => {
    if (count <= 1) {
      qs('.hairline-track > div', hairlineWrap).style.width = '0%';
      return;
    }
    qs('.hairline-track > div', hairlineWrap).style.width = `${Math.round((index / (count - 1)) * 100)}%`;
  };
  const stripEl = () => qs<HTMLElement>('.strip', strip);
  const move = (dir: 1 | -1) => {
    const next = Math.max(0, Math.min(stripState.count - 1, stripState.index + dir));
    if (next === stripState.index) return;
    stripState.index = next;
    const el = stripEl();
    const card = el.children[stripState.index] as HTMLElement | undefined;
    if (card) {
      el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: 'smooth' });
    }
    positionHairline(stripState.count, next);
  };
  // Keys from any control of the strip.
  strip.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
  });
  let lastWheel = 0;
  strip.addEventListener('wheel', (e) => {
    const delta = (e as WheelEvent).deltaY;
    if (delta === 0 || (e as WheelEvent).deltaX !== 0 && Math.abs((e as WheelEvent).deltaX) > Math.abs(delta)) return;
    const now = performance.now();
    if (now - lastWheel < 360) { e.preventDefault(); return; }
    if ((stripState.index === 0 && delta < 0) || (stripState.index === stripState.count - 1 && delta > 0)) return;
    e.preventDefault();
    lastWheel = now;
    move(delta > 0 ? 1 : -1);
  }, { passive: false });
  search.addEventListener('input', () => {
    state.q = search.value;
    const url = new URL(location.href);
    if (state.q) url.searchParams.set('q', state.q); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
    void load();
  });
  const filtersBtn = h('button', { 'aria-haspopup': 'dialog' }, 'Filters');
  filtersBtn.addEventListener('click', () => {
    openDialog('Filters', (panel, ctrl) => {
      const base = h('select', { 'aria-label': 'Base' },
        h('option', { value: '' }, 'Any base'), h('option', { value: 'split' }, 'Split'), h('option', { value: 'lavrio' }, 'Lavrio'));
      base.value = state.base;
      const cabins = h('select', { 'aria-label': 'Cabins' },
        h('option', { value: '' }, 'Any cabins'),
        h('option', { value: '3' }, '3 or more'), h('option', { value: '4' }, '4 or more'),
        h('option', { value: '5' }, '5 or more'), h('option', { value: '6' }, '6'));
      cabins.value = state.cabins;
      const season = h('select', { 'aria-label': 'Season' },
        h('option', { value: '' }, 'Any season'), h('option', { value: 'low' }, 'Low season'),
        h('option', { value: 'shoulder' }, 'Shoulder season'), h('option', { value: 'high' }, 'High season'));
      season.value = state.season;
      const weekSel = h('select', { 'aria-label': 'Week' }, h('option', { value: '' }, 'Any week'));
      const today = localDate('split', { ms: Date.now() });
      for (const w of weeksWindow('split', today)) {
        const opt = h('option', { value: w }, `Week of ${fmtDateOnly('split', w)}`);
        weekSel.append(opt);
      }
      weekSel.value = state.week;
      const apply = () => {
        state.base = base.value;
        state.cabins = cabins.value;
        state.season = season.value;
        state.week = weekSel.value;
        const url = new URL(location.href);
        url.searchParams.delete('base'); url.searchParams.delete('cabins'); url.searchParams.delete('season'); url.searchParams.delete('week');
        for (const [k, v] of Object.entries({ base: state.base, cabins: state.cabins, season: state.season, week: state.week })) {
          if (v) url.searchParams.set(k, v);
        }
        history.pushState(null, '', url);
        void load();
      };
      panel.append(
        h('div', { class: 'field' }, h('label', {}, 'Base'), base),
        h('div', { class: 'field' }, h('label', {}, 'Cabins'), cabins),
        h('div', { class: 'field' }, h('label', {}, 'Season'), season),
        h('div', { class: 'field' }, h('label', {}, 'Week'), weekSel),
        h('div', { style: 'display:flex;gap:0.6rem' },
          h('button', { class: 'primary', onclick: () => { apply(); ctrl.close(); } }, 'Show yachts'),
          h('button', {
            onclick: () => {
              base.value = ''; cabins.value = ''; season.value = ''; weekSel.value = '';
              apply();
              ctrl.close();
            },
          }, 'Clear filters'),
        ),
      );
      base.addEventListener('change', apply);
      cabins.addEventListener('change', apply);
      season.addEventListener('change', apply);
      weekSel.addEventListener('change', apply);
    });
  });
  const root = pageShell([
    h('header', { style: 'display:flex;gap:1rem;align-items:center;flex-wrap:wrap' },
      sunBadge(),
      heading,
    ),
    h('div', { style: 'display:flex;gap:0.7rem;align-items:center;margin:0.8rem 0' }, search, filtersBtn),
    strip,
    hairlineWrap,
  ]);
  await load();
  if (window.innerWidth >= 1024) hairlineWrap.style.display = 'block';
  window.addEventListener('resize', () => {
    hairlineWrap.style.display = window.innerWidth >= 1024 ? 'block' : 'none';
  });
  return root;
}

export async function publicYachtScreen(ws: string, slug: string): Promise<HTMLElement> {
  try {
    const y = await api<any>(`/api/public/fleets/${ws}/yachts/${slug}`);
    const weeks = h('ul', { 'aria-label': 'Weeks', class: 'cards-col', style: 'list-style:none;padding:0;display:contents' });
    for (const w of y.weeks) {
      weeks.append(h('li', { class: 'card', style: 'min-width:200px' },
        h('p', {}, `Week of ${fmtDateOnly('split', w.weekStart)}`),
        h('span', { class: `status-chip ${w.status}` }, w.status === 'free' ? 'Free' : w.status === 'held' ? 'Held' : 'Booked'),
        h('p', { class: 'num' }, fmtMoney(w.weeklyRateMinor, w.currency)),
      ));
    }
    return pageShell([
      h('h1', {}, y.name),
      h('div', { class: 'card', style: 'max-width:560px' },
        hullDrawing(y.name, y.lengthM, y.beamM),
        h('p', { class: 'num' }, fmtMeasurement(y.lengthM)),
        h('p', { class: 'num' }, `Beam ${fmtMeasurement(y.beamM)}`),
        h('p', { class: 'num' }, `Draft ${fmtMeasurement(y.draftM)}`),
        h('p', {}, `${y.cabins} cabins · ${y.base === 'split' ? 'Split' : 'Lavrio'}`),
        h('p', { class: 'num' }, `Low season ${fmtMoney(y.rates.lowMinor, 'EUR')} a week`),
        h('p', { class: 'num' }, `Shoulder season ${fmtMoney(y.rates.shoulderMinor, 'EUR')} a week`),
        h('p', { class: 'num' }, `High season ${fmtMoney(y.rates.highMinor, 'EUR')} a week`),
      ),
      h('h2', {}, 'Weeks'),
      h('div', { class: 'strip-wrap' }, h('div', { class: 'strip cards-col', tabindex: '0' }, weeks)),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 410) return gonePage();
    throw e;
  }
}
