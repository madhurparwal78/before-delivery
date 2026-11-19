// The transaction feed. Every refresh keeps the rows already shown, adds new
// rows only at the top, keeps focus and open controls, and never announces the
// row count.

import { el, clear, setBusy, clearBusy, isBusy } from '../dom.js';
import * as api from '../api.js';
import { announce } from '../status.js';
import { signedMoney, feedDate, METHOD_LABELS, initials } from '../format.js';

const METHOD_OPTIONS = [
  ['', 'All methods'],
  ['ach', 'ACH'],
  ['wire', 'Wire'],
  ['rtp', 'RTP'],
  ['check', 'Check'],
  ['card', 'Card'],
  ['transfer', 'Transfer'],
];

const DIRECTION_OPTIONS = [
  ['', 'In and out'],
  ['in', 'Money in'],
  ['out', 'Money out'],
];

export const DIRECTION_TO_API = { in: 'credit', out: 'debit' };

function select(label, options, value) {
  const id = `filter-${label.toLowerCase().replace(/\W/g, '-')}`;
  const node = el(
    'select',
    { id, 'aria-label': label },
    options.map(([optionValue, text]) => el('option', { value: optionValue, text }))
  );
  node.value = value || '';
  return el('div', { class: 'field' }, [el('label', { for: id, text: label }), node]);
}

function row(transaction) {
  const credit = transaction.direction === 'credit';
  return el('li', { class: 'feed-row', dataset: { transaction: transaction.id } }, [
    el('span', { class: 'feed-avatar', 'aria-hidden': 'true', text: initials(transaction.counterparty) }),
    el('span', { class: 'feed-main' }, [
      el('span', { class: 'feed-name', text: transaction.counterparty }),
      el('span', { class: 'feed-meta' }, [
        el('span', { class: 'chip', text: METHOD_LABELS[transaction.method] }),
        el('span', { text: feedDate(transaction.created_at) }),
        transaction.memo ? el('span', { text: transaction.memo }) : null,
      ]),
    ]),
    el('span', { class: `feed-amount mono ${credit ? 'amount-credit' : 'amount-debit'}` }, [
      signedMoney(transaction.amount_cents, transaction.direction),
      el('span', { class: 'direction-word', text: credit ? 'Money in' : 'Money out' }),
    ]),
  ]);
}

export function createFeed({ accountId = null, showAccountFilter = true, accounts = [], filters = {}, onFilterChange }) {
  const state = {
    filters: { account: filters.account || '', method: filters.method || '', direction: filters.direction || '' },
    rows: [],
    nodes: new Map(),
    pages: 1,
    cursor: null,
  };

  const list = el('ul', { class: 'feed', 'aria-label': 'Account transactions' });
  const empty = el('p', { class: 'hint', text: 'No transactions yet.', hidden: true });
  const more = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Show more transactions', hidden: true });

  const accountSelect = showAccountFilter
    ? select('Filter by account', [['', 'All accounts'], ...accounts.map((account) => [account.id, account.name])], state.filters.account)
    : null;
  const methodSelect = select('Filter by method', METHOD_OPTIONS, state.filters.method);
  const directionSelect = select('Filter by direction', DIRECTION_OPTIONS, state.filters.direction);

  const filterBar = el('fieldset', { class: 'filter-bar' }, [
    el('legend', { class: 'visually-hidden', text: 'Filter transactions' }),
    accountSelect,
    methodSelect,
    directionSelect,
  ]);
  filterBar.setAttribute('role', 'group');
  filterBar.setAttribute('aria-label', 'Filter transactions');

  const count = el('p', { class: 'hint' });

  function selects() {
    return {
      account: accountSelect ? accountSelect.querySelector('select') : null,
      method: methodSelect.querySelector('select'),
      direction: directionSelect.querySelector('select'),
    };
  }

  function address(cursor) {
    const parameters = new URLSearchParams();
    const account = accountId || state.filters.account;
    if (account) parameters.set('account_id', account);
    if (state.filters.method) parameters.set('method', state.filters.method);
    if (state.filters.direction) parameters.set('direction', DIRECTION_TO_API[state.filters.direction]);
    if (cursor) parameters.set('cursor', cursor);
    const query = parameters.toString();
    return `/api/transactions${query ? `?${query}` : ''}`;
  }

  async function fetchPages(pages) {
    const rows = [];
    let cursor = null;
    for (let page = 0; page < pages; page += 1) {
      const answer = await api.get(address(cursor));
      if (answer.status !== 200) return { failed: true, outage: api.isOutage(answer) };
      rows.push(...answer.json.transactions);
      cursor = answer.json.next_cursor;
      if (!cursor) break;
    }
    return { rows, cursor };
  }

  function paintCount() {
    count.textContent = `${state.rows.length} transactions shown`;
  }

  function announceCount() {
    announce(`${state.rows.length} transactions shown`);
  }

  function renderAll() {
    clear(list);
    state.nodes.clear();
    for (const transaction of state.rows) {
      const node = row(transaction);
      state.nodes.set(transaction.id, node);
      list.append(node);
    }
    empty.hidden = state.rows.length > 0;
    more.hidden = !state.cursor;
    paintCount();
  }

  // A reload: the feed starts again from its first page.
  async function reload({ announceResult = true } = {}) {
    const answer = await fetchPages(1);
    if (answer.failed) {
      if (answer.outage) announce(api.OUTAGE_MESSAGE);
      return;
    }
    state.rows = answer.rows;
    state.cursor = answer.cursor;
    state.pages = 1;
    renderAll();
    if (announceResult) announceCount();
  }

  // A refresh: every row already shown stays, and new rows enter only at the top.
  async function refresh() {
    const answer = await fetchPages(Math.max(state.pages, 1));
    if (answer.failed) return;
    const shown = new Set(state.rows.map((transaction) => transaction.id));
    const fresh = [];
    for (const transaction of answer.rows) {
      if (shown.has(transaction.id)) break;
      fresh.push(transaction);
    }
    if (fresh.length === 0) {
      if (!state.cursor && answer.cursor) {
        state.cursor = answer.cursor;
        more.hidden = false;
      }
      return;
    }
    state.rows = [...fresh, ...state.rows];
    const nodes = fresh.map((transaction) => {
      const node = row(transaction);
      state.nodes.set(transaction.id, node);
      return node;
    });
    list.prepend(...nodes);
    empty.hidden = true;
    paintCount();
  }

  async function showMore() {
    if (!state.cursor || isBusy(more)) return;
    setBusy(more, 'Loading…');
    const answer = await api.get(address(state.cursor));
    clearBusy(more);
    if (answer.status !== 200) {
      if (api.isOutage(answer)) announce(api.OUTAGE_MESSAGE);
      return;
    }
    const shown = new Set(state.rows.map((transaction) => transaction.id));
    for (const transaction of answer.json.transactions) {
      if (shown.has(transaction.id)) continue;
      state.rows.push(transaction);
      const node = row(transaction);
      state.nodes.set(transaction.id, node);
      list.append(node);
    }
    state.cursor = answer.json.next_cursor;
    state.pages += 1;
    more.hidden = !state.cursor;
    paintCount();
    announceCount();
  }

  more.addEventListener('click', showMore);

  for (const [key, wrapper] of [
    ['account', accountSelect],
    ['method', methodSelect],
    ['direction', directionSelect],
  ]) {
    if (!wrapper) continue;
    wrapper.querySelector('select').addEventListener('change', (event) => {
      state.filters[key] = event.target.value;
      if (onFilterChange) onFilterChange({ ...state.filters });
      reload();
    });
  }

  const node = el('div', {}, [filterBar, count, empty, list, el('div', { class: 'feed-foot' }, [more])]);

  return {
    node,
    list,
    moreButton: more,
    state,
    reload,
    refresh,
    rowCount: () => state.rows.length,
    setFilters(next, { reloadNow = true, announceResult = true } = {}) {
      state.filters = { account: next.account || '', method: next.method || '', direction: next.direction || '' };
      const current = selects();
      if (current.account) current.account.value = state.filters.account;
      current.method.value = state.filters.method;
      current.direction.value = state.filters.direction;
      if (reloadNow) return reload({ announceResult });
      return Promise.resolve();
    },
  };
}
