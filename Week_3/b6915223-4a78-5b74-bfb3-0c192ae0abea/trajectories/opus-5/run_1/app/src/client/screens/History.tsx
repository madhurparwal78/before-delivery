import { useCallback, useEffect, useState } from 'react';
import type { HistoryView, LedgerView, TransferHistoryRow } from '../../shared/types.ts';
import { formatMillions } from '../../shared/money.ts';
import { formatLeagueStamp } from '../../shared/leagueTime.ts';
import { api } from '../api.ts';
import { LiveRegion } from '../live.tsx';
import { useApp } from '../state.tsx';
import { HistoryTable } from '../components/HistoryTable.tsx';

export const usePlayerNames = (): Record<string, string> => {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void api.players('').then((result) => {
      setNames(
        Object.fromEntries(result.players.map((player) => [player.id, player.name])),
      );
    });
  }, []);
  return names;
};

export const History = () => {
  const { onStandings } = useApp();
  const names = usePlayerNames();
  const [history, setHistory] = useState<HistoryView | null>(null);
  const [transfers, setTransfers] = useState<TransferHistoryRow[]>([]);
  const [ledger, setLedger] = useState<LedgerView | null>(null);

  const refresh = useCallback(async () => {
    setHistory(await api.history());
    setTransfers((await api.transferHistory()).transfers);
    setLedger(await api.ledger());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => onStandings(() => void refresh()), [onStandings, refresh]);

  if (history === null || ledger === null) return <p className="empty">Loading history…</p>;

  return (
    <section className="page">
      <h1>History</h1>
      <HistoryTable
        rows={history.rows}
        names={names}
        snapshotHref={(gameweek) => `/api/history/${gameweek}/snapshot`}
      />

      <div className="table-frame">
        <table aria-label="Transfers" className="figures-table">
          <thead>
            <tr>
              <th scope="col">Gameweek</th>
              <th scope="col">Out</th>
              <th scope="col">Sold for</th>
              <th scope="col">In</th>
              <th scope="col">Bought for</th>
              <th scope="col">Made</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((transfer) => (
              <tr key={transfer.id}>
                <td className="mono">{transfer.gameweek}</td>
                <td>{transfer.out.name}</td>
                <td className="mono">{formatMillions(transfer.out.sell_price_tenths)}m</td>
                <td>{transfer.in.name}</td>
                <td className="mono">{formatMillions(transfer.in.price_tenths)}m</td>
                <td className="mono">{formatLeagueStamp(transfer.made_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-frame">
        <table aria-label="Bank ledger" className="figures-table">
          <thead>
            <tr>
              <th scope="col">Entry</th>
              <th scope="col">Player</th>
              <th scope="col">Gameweek</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {ledger.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.kind.replace('_', ' ')}</td>
                <td>{entry.player_id === null ? '—' : (names[entry.player_id] ?? entry.player_id)}</td>
                <td className="mono">{entry.gameweek ?? '—'}</td>
                <td className="mono">{formatMillions(entry.amount_tenths)}m</td>
              </tr>
            ))}
            <tr className="balance-row">
              <td>Balance</td>
              <td>—</td>
              <td>—</td>
              <td className="mono">{formatMillions(ledger.bank_tenths)}m</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="reconciliation mono">
        {`Bank ${formatMillions(ledger.bank_tenths)}m · Squad selling value ${formatMillions(
          ledger.squad_selling_value_tenths,
        )}m · Ledger balance ${formatMillions(ledger.bank_tenths)}m`}
      </p>
      <LiveRegion name="History updates" />
    </section>
  );
};
