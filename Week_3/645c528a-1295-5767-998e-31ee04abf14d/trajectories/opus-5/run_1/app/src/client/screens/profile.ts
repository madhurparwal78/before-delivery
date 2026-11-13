import { ledgerKindLabel, num, oneDecimal } from '../../shared/copy.js';
import { api } from '../api.js';
import { clear, el } from '../dom.js';
import { type Screen } from '../navigate.js';
import { state } from '../state.js';

interface LedgerLine {
  id: string;
  currency: 'coins' | 'cash';
  amount: number;
  kind: string;
  createdAt: string;
}

interface LedgerBody {
  balance: number;
  lines: LedgerLine[];
}

interface DisplayLine {
  date: string;
  kind: string;
  amount: string;
  balanceAfter: string;
  createdAt: number;
}

function buildLines(body: LedgerBody, currency: 'coins' | 'cash'): DisplayLine[] {
  const label = currency === 'coins' ? 'Coins' : 'Cash';
  let running = body.balance;
  return body.lines.map((line) => {
    const balanceAfter = running;
    running -= line.amount;
    return {
      date: line.createdAt.slice(0, 10),
      kind: ledgerKindLabel(line.kind),
      amount: `${line.amount >= 0 ? '+' : '-'}${num(Math.abs(line.amount))} ${label}`,
      balanceAfter: `${num(balanceAfter)} ${label}`,
      createdAt: new Date(line.createdAt).getTime(),
    };
  });
}

export function profileScreen(): Screen {
  const record = el('div', { className: 'record', attrs: { role: 'region', 'aria-label': 'Player record' } });
  const tbody = el('tbody');
  const table = el('table', {
    className: 'ledger',
    attrs: { 'aria-label': 'Ledger' },
    children: [
      el('thead', {
        children: [
          el('tr', {
            children: [
              el('th', { text: 'Date' }),
              el('th', { text: 'Kind' }),
              el('th', { text: 'Amount' }),
              el('th', { text: 'Balance after' }),
            ],
          }),
        ],
      }),
      tbody,
    ],
  });

  function renderRecord(): void {
    const me = state.me;
    clear(record);
    if (!me) return;
    record.append(
      el('p', { text: `Level ${num(me.level)}` }),
      el('p', { text: `Wins ${num(me.wins)}` }),
      el('p', { text: `Losses ${num(me.losses)}` }),
      el('p', { text: `Win rate ${oneDecimal(me.winRate)}%` }),
      el('p', { text: `Streak ${num(me.winStreak)}` }),
      el('p', { text: `Highest pot ${num(me.highestPot)}` }),
    );
  }

  async function loadLedger(): Promise<void> {
    const [coins, cash] = await Promise.all([
      api<LedgerBody>('GET', '/api/wallet/ledger?currency=coins'),
      api<LedgerBody>('GET', '/api/wallet/ledger?currency=cash'),
    ]);
    const lines: DisplayLine[] = [];
    if (coins.ok) lines.push(...buildLines(coins.data, 'coins'));
    if (cash.ok) lines.push(...buildLines(cash.data, 'cash'));
    lines.sort((first, second) => second.createdAt - first.createdAt);
    clear(tbody);
    for (const line of lines.slice(0, 50)) {
      tbody.append(
        el('tr', {
          children: [
            el('td', { text: line.date }),
            el('td', { text: line.kind }),
            el('td', { text: line.amount }),
            el('td', { text: line.balanceAfter }),
          ],
        }),
      );
    }
  }

  renderRecord();
  void loadLedger();

  return {
    element: el('div', {
      className: 'profile',
      children: [el('h1', { className: 'screen-heading', text: 'Profile', attrs: { tabindex: '-1' } }), record, table],
    }),
    update: renderRecord,
  };
}
