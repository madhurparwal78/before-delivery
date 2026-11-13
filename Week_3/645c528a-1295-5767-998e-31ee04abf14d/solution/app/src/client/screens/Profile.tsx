import { useEffect, useState, type ReactNode } from 'react';
import { formatNumber } from '../../shared/domain';
import { api, type LedgerLine } from '../api';
import type { Store } from '../store';
import { Screen } from '../ui';

const LEDGER_ROWS = 50;
const WORD = { coins: 'Coins', cash: 'Cash' };

interface Row extends LedgerLine {
  balanceAfter: number;
}

function withRunningBalance(lines: LedgerLine[]): Row[] {
  let running = 0;
  return [...lines].reverse().map((line) => {
    running += line.amount;
    return { ...line, balanceAfter: running };
  }).reverse();
}

function kindLabel(kind: string): string {
  const words = kind.replaceAll('_', ' ');
  return words[0].toUpperCase() + words.slice(1);
}

function signed(line: Row): string {
  return `${line.amount < 0 ? '-' : '+'}${formatNumber(Math.abs(line.amount))} ${WORD[line.currency]}`;
}

export function Profile({ store }: { store: Store }): ReactNode {
  const [rows, setRows] = useState<Row[]>([]);
  const { me } = store;
  useEffect(() => {
    const read = (currency: string): Promise<Row[]> =>
      api<{ lines: LedgerLine[] }>('GET', `/api/wallet/ledger?currency=${currency}`).then(({ lines }) => withRunningBalance(lines));
    void Promise.all([read('cash'), read('coins')]).then(([cash, coins]) => {
      const merged = [...cash, ...coins].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setRows(merged.slice(0, LEDGER_ROWS));
    }).catch(() => undefined);
  }, [me?.coins, me?.cash]);

  return (
    <Screen store={store} title={me?.displayName ?? 'Profile'}>
      {me !== null && (
        <section className="record" role="region" aria-label="Player record">
          <p>Level {formatNumber(me.level)}</p>
          <p>Wins {formatNumber(me.wins)}</p>
          <p>Losses {formatNumber(me.losses)}</p>
          <p>Win rate {me.winRate.toFixed(1)}%</p>
          <p>Streak {formatNumber(me.winStreak)}</p>
          <p>Highest pot {formatNumber(me.highestPot)}</p>
        </section>
      )}
      <h2>Ledger</h2>
      <table className="figures ledger" aria-label="Ledger">
        <thead>
          <tr><th scope="col">Date</th><th scope="col">Kind</th><th scope="col">Amount</th><th scope="col">Balance after</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.createdAt.slice(0, 10)}</td>
              <td>{kindLabel(row.kind)}</td>
              <td>{signed(row)}</td>
              <td>{formatNumber(row.balanceAfter)} {WORD[row.currency]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Screen>
  );
}
