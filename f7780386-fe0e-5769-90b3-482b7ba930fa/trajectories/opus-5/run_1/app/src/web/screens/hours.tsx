import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { LedgerTransaction } from '../../shared/api.js';
import { formatHours } from '../../shared/format.js';
import { api } from '../api.js';
import { useAction, useApp } from '../app-state.js';

interface LedgerView {
  balance_minutes: number;
  transactions: LedgerTransaction[];
}

export function HoursScreen(): ReactNode {
  const app = useApp();
  const act = useAction();
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    setLedger(await api<LedgerView>('/api/ledger'));
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const buy = async (packId: string, packName: string): Promise<void> => {
    setBusy(packId);
    await act(
      `Buying ${packName}…`,
      async () => {
        const result = await api<{ balance_minutes: number }>(
          `/api/packs/${packId}/purchase`,
          { method: 'POST', body: {} },
        );
        await refresh();
        await app.refreshSession();
        return `${packName} added. Balance: ${formatHours(result.balance_minutes)} h.`;
      },
      (error) =>
        error.code === 'billing_unavailable'
          ? 'Billing is unreachable right now. No charge was made; try again shortly.'
          : 'Billing is unreachable right now. No charge was made; try again shortly.',
    );
    setBusy('');
  };

  return (
    <>
      <h1>Hours</h1>
      <p className="balance-line">
        Balance {formatHours(ledger?.balance_minutes ?? 0)} h
      </p>

      <div className="pack-buttons">
        {(app.kitchen?.packs ?? []).map((pack) => (
          <span className="pack" key={pack.id}>
            <button
              type="button"
              className="primary"
              disabled={busy === pack.id}
              aria-busy={busy === pack.id}
              onClick={() => void buy(pack.id, pack.name)}
            >
              Buy {pack.name}
            </button>
            <span className="muted num">${pack.price}</span>
          </span>
        ))}
      </div>

      <table>
        <caption>Hours ledger</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Kind</th>
            <th scope="col">Hours</th>
            <th scope="col">Booking</th>
          </tr>
        </thead>
        <tbody>
          {(ledger?.transactions ?? []).map((transaction) => (
            <tr key={transaction.id}>
              <td data-label="Date" className="num">
                {transaction.created_at.slice(0, 10)}
              </td>
              <td data-label="Kind">{transaction.kind}</td>
              <td data-label="Hours" className="num">
                {formatHours(transaction.member_minutes)}
              </td>
              <td data-label="Booking">{transaction.booking_id ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
