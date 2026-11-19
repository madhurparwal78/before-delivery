import { el } from '../dom.js';
import { money, signedMoney, METHOD_LABELS, initials } from '../format.js';
import { marketingPage } from './layout.js';
import { sparkline } from '../cockpit/sparkline.js';

// A read-only rendering of the cockpit home filled with invented sample
// figures. It calls no cockpit API.
const SAMPLE = {
  total: 4825075,
  accounts: [
    { name: 'Sample Checking', balance: 1825075, available: 1725075, spark: [0, 0, 0, 120000, 120000, 450000, 450000, 450000, 980000, 980000, 980000, 1120000, 1120000, 1120000, 1320000, 1320000, 1320000, 1480000, 1480000, 1480000, 1480000, 1580000, 1580000, 1680000, 1680000, 1725075, 1725075, 1825075, 1825075, 1825075] },
    { name: 'Sample Savings', balance: 3000000, available: 3000000, spark: [...Array(10).fill(0), ...Array(20).fill(3000000)] },
  ],
  feed: [
    { counterparty: 'Brightline Media', method: 'ach', direction: 'credit', amount: 420000, date: 'Oct 27' },
    { counterparty: 'Northwind Supply', method: 'wire', direction: 'debit', amount: 125000, date: 'Oct 24' },
    { counterparty: 'Harbor Row Cafe', method: 'rtp', direction: 'credit', amount: 12500, date: 'Oct 22' },
    { counterparty: 'Corner Print Shop', method: 'card', direction: 'debit', amount: 8640, date: 'Oct 20' },
    { counterparty: 'Sample Savings', method: 'transfer', direction: 'debit', amount: 200000, date: 'Oct 18' },
  ],
};

export const demo = {
  title: 'Demo — Tallwind',
  render() {
    const cards = [
      el('div', { class: 'snap-card' }, [
        el('p', { class: 'snap-label', text: 'Total cash' }),
        el('p', { class: 'snap-figure mono', text: money(SAMPLE.total) }),
        el('p', { class: 'snap-available mono', text: `Available ${money(SAMPLE.total - 100000)}` }),
      ]),
      ...SAMPLE.accounts.map((account) =>
        el('div', { class: 'snap-card' }, [
          el('p', { class: 'snap-label', text: account.name }),
          el('p', { class: 'snap-figure mono', text: money(account.balance) }),
          el('p', { class: 'snap-available mono', text: `Available ${money(account.available)}` }),
          sparkline(account.spark),
        ])
      ),
    ];

    const feed = el(
      'ul',
      { class: 'feed', 'aria-label': 'Sample transaction feed' },
      SAMPLE.feed.map((row) =>
        el('li', { class: 'feed-row' }, [
          el('span', { class: 'feed-avatar', 'aria-hidden': 'true', text: initials(row.counterparty) }),
          el('span', { class: 'feed-main' }, [
            el('span', { class: 'feed-name', text: row.counterparty }),
            el('span', { class: 'feed-meta' }, [
              el('span', { class: 'chip', text: METHOD_LABELS[row.method] }),
              el('span', { text: row.date }),
            ]),
          ]),
          el('span', { class: `feed-amount mono ${row.direction === 'credit' ? 'amount-credit' : 'amount-debit'}` }, [
            signedMoney(row.amount, row.direction),
            el('span', { class: 'direction-word', text: row.direction === 'credit' ? 'Money in' : 'Money out' }),
          ]),
        ])
      )
    );

    return marketingPage([
      el('div', { class: 'demo-banner' }, [
        el('p', { style: 'margin:0', text: 'This is a demo with sample data' }),
        el('a', { class: 'pill', href: '/signup', text: 'Open account' }),
      ]),
      el('div', { class: 'wrap section' }, [
        el('h1', { text: 'The Tallwind cockpit' }),
        el('div', { class: 'snapshot-cards cols-2', style: '--card-count:3' }, cards),
        el('h2', { text: 'Transactions' }),
        feed,
      ]),
    ]);
  },
};
