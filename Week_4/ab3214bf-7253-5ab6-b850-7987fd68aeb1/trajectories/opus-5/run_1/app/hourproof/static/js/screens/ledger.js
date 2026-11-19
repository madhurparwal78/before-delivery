// The ledger: every movement as an equal pair of entries.

import { get } from '../api.js';
import { clear, el } from '../dom.js';
import { commas } from '../format.js';
import { linkTo } from '../router.js';

export async function mount({ container, params }) {
  const windowId = params[0];
  let page = 1;
  const balances = el('div', {
    role: 'region',
    'aria-label': 'Balances',
    className: 'panel stack',
  });
  const body = el('tbody');
  const table = el('table', { 'aria-label': 'Ledger entries' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Movement' }),
        el('th', { scope: 'col', text: 'Kind' }),
        el('th', { scope: 'col', text: 'Account' }),
        el('th', { scope: 'col', text: 'Watt-hours' }),
        el('th', { scope: 'col', text: 'Label' }),
        el('th', { scope: 'col', text: 'At' }),
      ]),
    ]),
    body,
  ]);
  const empty = el('p', { className: 'word', text: 'NO MOVEMENTS YET.', hidden: true });
  const next = el('button', { type: 'button', text: 'Next page' });
  const previous = el('button', { type: 'button', text: 'Previous page' });
  next.addEventListener('click', () => {
    page += 1;
    load();
  });
  previous.addEventListener('click', () => {
    page = Math.max(1, page - 1);
    load();
  });
  container.append(
    el('div', { className: 'panel stack' }, [
      el('h1', { text: 'EVERY WATT-HOUR, ACCOUNTED.' }),
      linkTo(`/windows/${windowId}`, 'Window desk'),
    ]),
    el('div', { className: 'ledger-grid' }, [
      balances,
      el('div', { className: 'panel panel--white stack' }, [
        el('div', { className: 'table-wrap' }, [table]),
        empty,
        el('div', { className: 'row' }, [previous, next]),
      ]),
    ])
  );

  async function load() {
    const answer = await get(`/api/windows/${windowId}/ledger?page=${page}`);
    if (answer.status !== 200) return;
    const data = answer.data;
    page = data.page;
    clear(balances);
    balances.append(
      el('h3', { text: 'BALANCES.' }),
      el('p', { text: `Opening ${commas(data.opening_wh)} Wh` }),
      el('p', { text: `Holdings ${commas(data.balances.holdings_wh)} Wh` }),
      el('p', { text: `Allocated ${commas(data.balances.allocated_wh)} Wh` }),
      el('p', { text: `Cancelled ${commas(data.balances.cancelled_wh)} Wh` }),
      el('p', { text: `Loss ${commas(data.balances.loss_wh)} Wh` }),
      el('p', { text: `Page ${data.page} of ${data.page_count}` })
    );
    clear(body);
    data.entries.forEach((entry) =>
      body.append(
        el('tr', {}, [
          el('td', { text: entry.movement_id }),
          el('td', { text: entry.kind }),
          el('td', { text: entry.account }),
          el('td', { text: `${commas(entry.wh)} Wh` }),
          el('td', { text: entry.label }),
          el('td', { text: entry.at }),
        ])
      )
    );
    empty.hidden = data.entries.length > 0;
    previous.setAttribute('aria-disabled', page <= 1 ? 'true' : 'false');
    next.setAttribute('aria-disabled', page >= data.page_count ? 'true' : 'false');
  }

  await load();
  return { refresh: load };
}
