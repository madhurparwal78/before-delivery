// The cockpit home: the snapshot row, the voice readout and the live feed
// whose filters live in the page address.

import { el, clear, icon } from '../dom.js';
import * as router from '../router.js';
import { announce } from '../status.js';
import { money } from '../format.js';
import * as data from './data.js';
import { sparkline } from './sparkline.js';
import { createFeed } from './feed.js';
import { layout } from './shell.js';

const METHODS = ['ach', 'wire', 'rtp', 'check', 'card', 'transfer'];
const DIRECTIONS = ['in', 'out'];

// The feed's filters are mirrored in the address, in a published order.
export function filtersFromQuery(query, accounts, { allowAccount = true } = {}) {
  const wanted = {
    account: allowAccount ? query.get('account') || '' : '',
    method: query.get('method') || '',
    direction: query.get('direction') || '',
  };
  const clean = {
    account: accounts.some((account) => account.id === wanted.account) ? wanted.account : '',
    method: METHODS.includes(wanted.method) ? wanted.method : '',
    direction: DIRECTIONS.includes(wanted.direction) ? wanted.direction : '',
  };
  const dropped =
    (query.has('account') && clean.account !== query.get('account')) ||
    (query.has('method') && clean.method !== query.get('method')) ||
    (query.has('direction') && clean.direction !== query.get('direction'));
  return { filters: clean, dropped };
}

export function addressFor(base, filters) {
  const parameters = [];
  if (filters.account) parameters.push(`account=${encodeURIComponent(filters.account)}`);
  if (filters.method) parameters.push(`method=${encodeURIComponent(filters.method)}`);
  if (filters.direction) parameters.push(`direction=${encodeURIComponent(filters.direction)}`);
  return parameters.length ? `${base}?${parameters.join('&')}` : base;
}

function snapshotCard(label, { withSparkline = false } = {}) {
  const figure = el('p', { class: 'snap-figure mono' });
  const available = el('p', { class: 'snap-available mono' });
  const line = withSparkline ? el('div', {}) : null;
  const node = el('div', { class: 'snap-card' }, [
    el('p', { class: 'snap-label', text: label }),
    figure,
    available,
    line,
  ]);
  return { node, figure, available, line };
}

export function snapshotRow() {
  const cards = el('div', { class: 'snapshot-cards' });
  const total = snapshotCard('Total cash');
  const perAccount = new Map();

  function paint() {
    const snapshot = data.state.snapshot;
    const accounts = data.state.accounts;
    if (!snapshot) {
      if (!total.node.isConnected) {
        total.figure.textContent = '—';
        total.available.textContent = 'Available —';
        cards.append(total.node);
      }
      return;
    }
    if (!total.node.isConnected) cards.append(total.node);
    total.figure.textContent = money(snapshot.total_cash_cents);
    total.available.textContent = `Available ${money(snapshot.total_available_cents)}`;

    const wanted = accounts.map((account) => account.id).join(',');
    if (cards.dataset.accounts !== wanted) {
      cards.dataset.accounts = wanted;
      for (const [, card] of perAccount) card.node.remove();
      perAccount.clear();
      for (const account of accounts) {
        const card = snapshotCard(account.name, { withSparkline: true });
        perAccount.set(account.id, card);
        cards.append(card.node);
      }
    }
    for (const account of accounts) {
      const card = perAccount.get(account.id);
      const figures = snapshot.per_account.find((entry) => entry.account_id === account.id);
      if (!card || !figures) continue;
      // A changed figure swaps at once, with no animation.
      card.figure.textContent = money(figures.balance_cents);
      card.available.textContent = `Available ${money(figures.available_cents)}`;
      clear(card.line);
      card.line.append(sparkline(figures.sparkline));
    }
    applyColumns();
  }

  function applyColumns() {
    const current = layout();
    const count = 1 + data.state.accounts.length;
    cards.classList.remove('cols-1', 'cols-2', 'cols-all');
    cards.classList.add(current.cards === 'one' ? 'cols-1' : current.cards === 'two' ? 'cols-2' : 'cols-all');
    cards.style.setProperty('--card-count', String(count));
  }

  return { node: cards, paint, applyColumns };
}

export function readAloudButton() {
  const supported = typeof window.speechSynthesis !== 'undefined';
  const button = el('button', { type: 'button', class: 'btn btn-secondary' }, [
    icon('speaker', { size: 18 }),
    'Read balances aloud',
  ]);
  if (!supported) button.disabled = true;
  button.addEventListener('click', () => {
    if (!supported || !data.state.snapshot) return;
    window.speechSynthesis.cancel();
    const lines = [`Total cash is $${money(data.state.snapshot.total_cash_cents).slice(1)}`];
    for (const account of data.state.accounts) {
      const figures = data.perAccount(account.id);
      lines.push(`${account.name} is ${money(figures ? figures.balance_cents : account.balance_cents)}`);
    }
    for (const line of lines) window.speechSynthesis.speak(new SpeechSynthesisUtterance(line));
  });
  return button;
}

export const home = {
  title: 'Cockpit — Tallwind',
  async render(context) {
    if (!data.state.snapshot) await data.refreshMoney();
    const accounts = data.state.accounts;
    const { filters, dropped } = filtersFromQuery(context.query, accounts);
    if (dropped) router.setAddress(addressFor('/app', filters), { replace: true });

    const snapshot = snapshotRow();
    const feed = createFeed({
      accounts,
      filters,
      showAccountFilter: true,
      onFilterChange: (next) => {
        // Each change adds exactly one history entry.
        router.setAddress(addressFor('/app', next), { replace: false });
      },
    });

    const node = el('div', {}, [
      el('div', { class: 'snapshot-head' }, [
        el('h1', { text: 'Your money today' }),
        el('div', { class: 'snapshot-actions' }, [
          el('a', { class: 'pill', href: '/payments/new', text: 'Send payment' }),
          readAloudButton(),
        ]),
      ]),
      snapshot.node,
      el('h2', { text: 'Transactions' }),
      feed.node,
    ]);

    snapshot.paint();
    feed.reload({ announceResult: true });

    const unsubscribe = data.subscribe((event) => {
      if (event.type === 'money' || event.type === 'recovered') snapshot.paint();
      if (event.type === 'transaction' || event.type === 'recovered') feed.refresh();
    });
    const timer = setInterval(() => feed.refresh(), 10000);
    const offLayout = context.shell ? context.shell.onLayout(() => snapshot.applyColumns()) : null;
    const onResize = () => snapshot.applyColumns();
    window.addEventListener('resize', onResize);
    router.onCleanup(() => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener('resize', onResize);
      if (offLayout) offLayout();
    });

    return node;
  },
};
