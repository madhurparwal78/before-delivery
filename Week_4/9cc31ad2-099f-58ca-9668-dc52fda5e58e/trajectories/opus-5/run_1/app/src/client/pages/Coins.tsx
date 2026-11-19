import { useCallback, useEffect, useState } from 'react';
import { formatThousands } from '../../shared/format.js';
import { apiGet } from '../api.js';
import { Page } from '../components/Page.js';
import { usePush } from '../store.js';

interface Movement {
  movementId: string;
  kind: string;
  createdAt: string;
  runId: string | null;
  entries: { account: string; amount: number }[];
}

interface LedgerBody {
  balance: number;
  total: number;
  movements: Movement[];
}

const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Opening balance',
  pickups: 'Coin pickups',
  result: 'Race result',
  upgrade: 'Upgrade',
  car: 'Car purchase',
  refit: 'Refit refund',
  finals: 'Finals reward',
};

function signed(amount: number): string {
  return `${amount < 0 ? '−' : '+'}${formatThousands(Math.abs(amount))}`;
}

export function Coins() {
  const [ledger, setLedger] = useState<LedgerBody | null>(null);

  const load = useCallback(async () => {
    const result = await apiGet<LedgerBody>('/v1/ledger');
    if (result.kind === 'ok') setLedger(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  usePush(
    useCallback(
      (push) => {
        if (push.type === 'balance') void load();
      },
      [load],
    ),
  );

  return (
    <Page gutter={['Totals', 'History']}>
      <h1>Coin history</h1>
      <div className="cell" role="region" aria-label="Coin totals">
        <p className="figure">Balance {formatThousands(ledger?.balance ?? 0)} coins</p>
        <p className="figure">Ledger total {formatThousands(ledger?.total ?? 0)} coins</p>
      </div>
      <table aria-label="Coin history">
        <thead>
          <tr>
            <th>When</th>
            <th>Movement</th>
            <th className="num">Wallet</th>
            <th>Counter account</th>
          </tr>
        </thead>
        <tbody>
          {(ledger?.movements ?? []).map((movement) => {
            const wallet = movement.entries.find((entry) => entry.account.startsWith('wallet:'));
            const counter = movement.entries.find((entry) => entry.account.startsWith('house:'));
            return (
              <tr key={movement.movementId}>
                <td className="mono">{new Date(movement.createdAt).toISOString().slice(0, 19).replace('T', ' ')}</td>
                <td>{MOVEMENT_LABELS[movement.kind] ?? movement.kind}</td>
                <td className="num">{signed(wallet?.amount ?? 0)}</td>
                <td>
                  {counter?.account}{' '}
                  <span className="mono">{signed(counter?.amount ?? 0)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Page>
  );
}
