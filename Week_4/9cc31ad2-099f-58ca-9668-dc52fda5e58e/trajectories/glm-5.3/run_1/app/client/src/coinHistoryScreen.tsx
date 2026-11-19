// Coin history: totals and the paired ledger movements, newest first.
import { useEffect, useState, type JSX } from 'react';
import { api } from './api';
import { fmtCoins } from './formats';

export default function CoinHistoryScreen(): JSX.Element {
  const [data, setData] = useState<{ balance: number; total: number; movements: {
    movementId: string; kind: string; createdAt: string; runId: string | null;
    entries: { account: string; amount: number }[];
  }[] } | null>(null);

  useEffect(() => {
    void api.ledger().then(setData).catch(() => setData(null));
  }, []);

  return (
    <main className="page" style={{ paddingTop: 20 }}>
      <h1>Coin history</h1>
      {!data && <p>Loading…</p>}
      {data && (
        <>
          <section className="rule-cell" aria-label="Coin totals" style={{ marginBottom: 16 }}>
            <div>Balance <span className="mono">{fmtCoins(data.balance)} coins</span></div>
            <div>Ledger total <span className="mono">{fmtCoins(data.total)} coins</span></div>
          </section>
          <table className="table" aria-label="Coin history">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Movement</th>
                <th scope="col" className="num">Wallet</th>
                <th scope="col">Counter account</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map(m => (
                <tr key={m.movementId}>
                  <td>{new Date(m.createdAt).toLocaleString()}</td>
                  <td>{m.kind}</td>
                  <td className={`num ${m.entries[0].amount >= 0 ? 'gain' : 'loss'}`}>
                    {m.entries[0].amount >= 0 ? '+' : '−'}{fmtCoins(Math.abs(m.entries[0].amount))}
                  </td>
                  <td>
                    {m.entries[1].account}{' '}
                    <span className={`num ${m.entries[1].amount >= 0 ? 'gain' : 'loss'}`}>
                      {m.entries[1].amount >= 0 ? '+' : '−'}{fmtCoins(Math.abs(m.entries[1].amount))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
