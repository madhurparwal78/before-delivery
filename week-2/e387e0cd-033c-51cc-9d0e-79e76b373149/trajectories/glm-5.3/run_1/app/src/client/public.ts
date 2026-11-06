// Public pages: the directory with its filter rail, jurisdiction and exchange
// pages, the network band and the stats band.
import { h, inputText, radioGroup } from './dom.js';
import { api } from './api.js';
import { navigate } from './router.js';
import { openDialog, type PanelHandle } from './panels.js';
import { menuButton } from './menus.js';
import { liveRegion } from './feedback.js';
import { formatFiat, formatShortDate } from './format.js';

interface JurisdictionCard { code: string; name: string; region: string; currency: string; status: string; thresholdCents: number | null; inForceSince: string | null; announcedChange: { thresholdCents: number; takesEffectOn: string } | null }
interface ExchangeCard { slug: string; name: string; jurisdictionCode: string; region: string; status: string; onNetwork: boolean }

const REGIONS = [
  { value: '', label: 'All regions' },
  { value: 'europe', label: 'Europe' },
  { value: 'asia_pacific', label: 'Asia Pacific' },
  { value: 'middle_east', label: 'Middle East' },
  { value: 'americas', label: 'Americas' },
  { value: 'africa', label: 'Africa' },
];
const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'in_force', label: 'In force' },
  { value: 'announced', label: 'Announced' },
  { value: 'no_rule', label: 'No rule' },
];

export function publicHeader(): HTMLElement {
  const wordmark = h('a', { href: '/', class: 'wordmark' }, 'Lanternline');
  const directoryMenu = menuButton('Directory', [
    { label: 'Jurisdictions', onActivate: () => document.getElementById('jurisdictions')?.scrollIntoView({ behavior: 'smooth' }) },
    { label: 'Listed exchanges', onActivate: () => document.getElementById('listed-exchanges')?.scrollIntoView({ behavior: 'smooth' }) },
  ], 'header');
  const deskMenu = menuButton('Desk', [
    { label: 'How it works', onActivate: () => document.getElementById('network-band')?.scrollIntoView({ behavior: 'smooth' }) },
    { label: 'Sign in', onActivate: () => navigate('/sign-in') },
  ], 'header');
  return h('header', { class: 'public-header' }, wordmark, h('div', { class: 'header-menus' }, directoryMenu, deskMenu));
}

function statusText(status: string): string {
  if (status === 'in_force') return 'In force';
  if (status === 'announced') return 'Announced';
  return 'No rule';
}

export async function renderPublicHome(root: HTMLElement): Promise<void> {
  const status = liveRegion('Directory status');
  const url = new URL(location.href);
  let region = url.searchParams.get('region') ?? '';
  let ruleStatus = url.searchParams.get('status') ?? '';
  let query = url.searchParams.get('q') ?? '';

  const jurisdictionsList = h('ul', { 'aria-label': 'Jurisdictions', id: 'jurisdictions', class: 'card-list' });
  const exchangesList = h('ul', { 'aria-label': 'Listed exchanges', id: 'listed-exchanges', class: 'card-list' });

  let requestCounter = 0;
  async function refresh(commit: boolean, key?: string, value?: string): Promise<void> {
    if (commit) {
      const next = new URL(location.href);
      if (key !== undefined && value !== undefined) {
        if (value === '') next.searchParams.delete(key);
        else next.searchParams.set(key, value);
      }
      history.pushState({}, '', next.href);
    }
    const request = ++requestCounter;
    const [jur, ex] = await Promise.all([
      api<{ jurisdictions: JurisdictionCard[] }>('GET', `/api/public/jurisdictions?region=${region}&status=${ruleStatus}`),
      api<{ exchanges: ExchangeCard[] }>('GET', `/api/public/exchanges?q=${encodeURIComponent(query)}&region=${region}&status=${ruleStatus}`),
    ]);
    if (request !== requestCounter) return; // an older answer never wins
    const jurisdictions = jur.body?.jurisdictions ?? [];
    const exchanges = ex.body?.exchanges ?? [];
    jurisdictionsList.replaceChildren(...jurisdictions.map((j) => h('li', { class: 'card jurisdiction-card' },
      h('a', { href: `/jurisdictions/${j.code}`, class: 'card-title' }, j.name),
      h('p', { class: 'card-line' }, statusText(j.status)),
      j.thresholdCents !== null ? h('p', { class: 'card-line mono' }, formatFiat(j.currency, j.thresholdCents)) : null,
      j.inForceSince !== null ? h('p', { class: 'card-line mono' }, `In force since ${formatShortDate(new Date(j.inForceSince), 'UTC')}`) : null,
      j.announcedChange !== null ? h('p', { class: 'card-line mono' }, `Announced: ${formatFiat(j.currency, j.announcedChange.thresholdCents)} from ${j.announcedChange.takesEffectOn}`) : null)));
    exchangesList.replaceChildren(...exchanges.map((x) => h('li', { class: 'card exchange-card' },
      h('a', { href: `/exchanges/${x.slug}`, class: 'card-title' }, x.name),
      h('p', { class: 'card-line' }, `${x.jurisdictionCode} · ${x.onNetwork ? 'On network' : 'Off network'}`))));
    const count = exchanges.length;
    status.textContent = count === 1 ? '1 exchange matches' : `${count} exchanges match`;
  }

  const regionGroup = radioGroup('Region', REGIONS.map((r) => ({ value: r.value, label: r.label, checked: r.value === region })));
  regionGroup.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    region = target.value;
    void refresh(true, 'region', region);
  });
  const statusGroup = radioGroup('Status', STATUSES.map((s) => ({ value: s.value, label: s.label, checked: s.value === ruleStatus })));
  statusGroup.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    ruleStatus = target.value;
    void refresh(true, 'status', ruleStatus);
  });
  const search = inputText({ id: 'search', 'aria-label': 'Search exchanges', class: 'input search-box', type: 'search' });
  search.value = query;
  let commitTimer: number | undefined;
  search.addEventListener('input', () => {
    query = search.value;
    const next = new URL(location.href);
    if (query === '') next.searchParams.delete('q');
    else next.searchParams.set('q', query);
    history.replaceState({}, '', next.href);
    window.clearTimeout(commitTimer);
    void refresh(false);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void refresh(true, 'q', query);
    }
  });
  search.addEventListener('blur', () => {
    void refresh(true, 'q', query);
  });

  const statsRes = await api<{ jurisdictions: number; rulesInForce: number; listedExchanges: number }>('GET', '/api/public/stats');
  const stats = statsRes.body;
  const filterRail = h('div', { class: 'filter-rail', 'aria-label': 'Filters' },
    h('h2', {}, 'Filters'), regionGroup, statusGroup, search);

  const statsBand = h('div', { role: 'region', 'aria-label': 'Network figures', class: 'stats-band' },
    figure(stats?.jurisdictions ?? 0, 'jurisdictions tracked'),
    figure(stats?.rulesInForce ?? 0, 'rules in force'),
    figure(stats?.listedExchanges ?? 0, 'listed exchanges'));

  const filtersSheet = h('button', { type: 'button', class: 'btn filters-button', 'aria-label': 'Filters', onclick: (e: Event) => {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Filters', kind: 'sheet', opener: e.currentTarget as HTMLElement, onClose: () => {},
      build: (dialog) => {
        const regionGroup2 = radioGroup('Region', REGIONS.map((r) => ({ value: r.value, label: r.label, checked: r.value === region })));
        const statusGroup2 = radioGroup('Status', STATUSES.map((s) => ({ value: s.value, label: s.label, checked: s.value === ruleStatus })));
        const search2 = inputText({ id: 'search2', 'aria-label': 'Search exchanges', class: 'input search-box', type: 'search' });
        search2.value = query;
        regionGroup2.addEventListener('change', (ev) => { region = (ev.target as HTMLInputElement).value; });
        statusGroup2.addEventListener('change', (ev) => { ruleStatus = (ev.target as HTMLInputElement).value; });
        search2.addEventListener('input', () => { query = search2.value; });
        dialog.append(h('h2', {}, 'Filters'), regionGroup2, statusGroup2, search2,
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Show results', onclick: async () => {
              syncRadioChecks();
              panel.close();
              await refresh(true);
            } }, 'Show results')));
      },
    });
  } }, 'Filters');

  root.append(
    publicHeader(),
    h('h1', { class: 'home-title' }, 'Every withdrawal, answered before it leaves'),
    networkBand(),
    statsBand,
    h('div', { class: 'directory-layout' },
      filterRail,
      h('div', { class: 'directory-results' },
        h('h2', { id: 'jurisdictions-heading' }, 'Jurisdictions'), jurisdictionsList,
        h('h2', { id: 'listed-exchanges-heading' }, 'Listed exchanges'), exchangesList)),
    filtersSheet,
    status,
  );

  function syncRadioChecks(): void {
    document.querySelectorAll<HTMLInputElement>('#search').forEach((el) => { el.value = query; });
  }

  function figure(value: number, label: string): HTMLElement {
    const fig = h('div', { class: 'stat-figure' });
    const digitsEl = h('span', { class: 'stat-digits mono', 'aria-label': `${value} ${label}` }, '0');
    fig.append(digitsEl, h('span', { class: 'stat-label' }, `${value === 1 ? label : label}`));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      digitsEl.textContent = String(value);
    } else {
      const target = String(value);
      requestAnimationFrame(() => {
        digitsEl.classList.add('rolling');
        digitsEl.textContent = target;
        setTimeout(() => digitsEl.classList.remove('rolling'), 320);
      });
    }
    return fig;
  }

  await refresh(false);
}

function networkBand(): HTMLElement {
  const band = h('div', { id: 'network-band', class: 'network-band' });
  const img = h('div', { role: 'img', 'aria-label': 'Lanternline network', class: 'network-illustration' });
  const nodes = 14;
  const rings: HTMLElement[] = [];
  for (let i = 0; i < nodes; i++) {
    const node = h('span', { class: `network-node node-${i}`, 'aria-hidden': 'true' });
    img.append(node);
    rings.push(node);
  }
  for (let i = 0; i < nodes; i++) {
    const connector = h('span', { class: `network-connector connector-${i}`, 'aria-hidden': 'true' });
    img.append(connector);
    const packet = h('span', { class: `network-packet packet-${i}`, 'aria-hidden': 'true' });
    img.append(packet);
  }
  void rings;
  band.append(h('h2', {}, 'How it works'), img,
    h('p', { class: 'band-copy' }, 'Travel Rule data travels between licensed exchanges before a withdrawal leaves.'));
  return band;
}

export async function renderJurisdictionPage(root: HTMLElement, code: string): Promise<void> {
  const res = await api<{ jurisdiction: JurisdictionCard; exchanges: ExchangeCard[] }>('GET', `/api/public/jurisdictions/${code}`);
  if (!res.ok || res.body === null) {
    root.append(publicHeader(), h('main', { class: 'public-main' }, h('h1', {}, 'Page not found'), h('p', {}, "We couldn't find that page.")));
    return;
  }
  const j = res.body.jurisdiction;
  root.append(publicHeader(), h('main', { class: 'public-main' },
    h('div', { class: 'screen-head' }, h('h1', {}, j.name)),
    h('div', { class: 'jurisdiction-layout' },
      h('div', { class: 'rule-panel panel' },
        h('h2', {}, 'Rule'),
        h('p', { class: 'card-line' }, statusText(j.status)),
        j.thresholdCents !== null ? h('p', { class: 'card-line mono' }, `Threshold ${formatFiat(j.currency, j.thresholdCents)}`) : null,
        j.inForceSince !== null ? h('p', { class: 'card-line mono' }, `In force since ${formatShortDate(new Date(j.inForceSince), 'UTC')}`) : null,
        j.announcedChange !== null ? h('p', { class: 'card-line mono' }, `Announced change: ${formatFiat(j.currency, j.announcedChange.thresholdCents)} from ${j.announcedChange.takesEffectOn}`) : h('p', { class: 'card-line' }, 'No announced change.')),
      h('div', { class: 'panel' },
        h('h2', {}, 'Listed exchanges'),
        h('ul', { class: 'card-list' }, res.body.exchanges.map((x) => h('li', { class: 'card exchange-card' },
          h('a', { href: `/exchanges/${x.slug}`, class: 'card-title' }, x.name),
          h('p', { class: 'card-line' }, `${x.onNetwork ? 'On network' : 'Off network'}`))))))));
}

export async function renderExchangePage(root: HTMLElement, slug: string): Promise<void> {
  const res = await api<{ exchange: ExchangeCard }>('GET', `/api/public/exchanges/${slug}`);
  if (res.status === 410) {
    root.append(publicHeader(), h('main', { class: 'public-main' }, h('h1', {}, 'Listing withdrawn'),
      h('p', {}, 'This exchange has withdrawn its listing.')));
    return;
  }
  if (!res.ok || res.body === null) {
    root.append(publicHeader(), h('main', { class: 'public-main' }, h('h1', {}, 'Page not found'), h('p', {}, "We couldn't find that page.")));
    return;
  }
  const x = res.body.exchange;
  root.append(publicHeader(), h('main', { class: 'public-main' },
    h('div', { class: 'screen-head' }, h('h1', {}, x.name)),
    h('div', { class: 'panel' },
      h('p', { class: 'card-line' }, `Jurisdiction: ${x.jurisdictionCode}`),
      h('p', { class: 'card-line' }, `Rule status: ${statusText(x.status)}`),
      h('p', { class: 'card-line' }, x.onNetwork ? 'On the message network' : 'Off the message network'),
      h('p', { class: 'card-line' }, h('a', { href: `/jurisdictions/${x.jurisdictionCode}` }, `See the ${x.jurisdictionCode} rule`)))));
}

export function renderNotFound(root: HTMLElement): void {
  root.append(publicHeader(), h('main', { class: 'public-main' }, h('h1', {}, 'Page not found'),
    h('p', {}, "We couldn't find that page."),
    h('p', {}, h('a', { href: '/', class: 'link' }, 'Back to the directory'))));
}
