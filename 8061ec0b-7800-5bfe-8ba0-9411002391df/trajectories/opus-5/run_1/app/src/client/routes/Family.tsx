import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '../../shared/money';
import type { FamilyResponse } from '../../shared/types';
import { api } from '../lib/api';
import { setRowOrigin } from '../lib/transition';

const STATUS_WORDS: Record<string, string> = {
  reserved: 'Reserved',
  agreement_sent: 'Agreement sent',
  signed: 'Signed',
  active: 'Active',
  expired: 'Expired',
  exchanged: 'Exchanged',
  paid_off: 'Owned',
  returned: 'Returned',
  written_off: 'Written off',
};

export function Family(): ReactNode {
  const [data, setData] = useState<FamilyResponse | null>(null);

  useEffect(() => {
    void (async () => {
      setData(await api<FamilyResponse>('/family'));
    })();
  }, []);

  if (data === null) return <main className="page">Loading…</main>;

  return (
    <main className="page">
      <h1>My family</h1>
      <section className="totals-line" aria-label="Family totals">
        <span>
          <span className="label">Equity across open contracts </span>
          <span className="brass">{formatMoney(data.totals.equity_cents)}</span>
        </span>
        <span className="figure">{`${data.totals.owned} owned`}</span>
      </section>

      {data.students.map((student) => {
        const open = student.contracts.filter((contract) =>
          ['reserved', 'agreement_sent', 'signed', 'active'].includes(contract.status),
        );
        return (
          <section className="child-section" aria-label={student.name} key={student.id}>
            <h2>{student.name}</h2>
            <p>{student.school.name}</p>
            {student.contracts.length === 0 ? <p>No contracts yet.</p> : null}
            <ul className="plain">
              {student.contracts.map((contract) => (
                <li key={contract.id}>
                  <Link
                    to={`/contracts/${contract.id}`}
                    className="mono"
                    onClick={(event) => {
                      const row = (event.currentTarget as HTMLElement).closest('li');
                      if (row !== null) setRowOrigin(contract.id, row);
                    }}
                  >
                    {contract.id}
                  </Link>{' '}
                  {contract.instrument_label} · <span className="mono">{contract.serial}</span> ·{' '}
                  {STATUS_WORDS[contract.status] ?? contract.status} ·{' '}
                  <span className="brass">{formatMoney(contract.equity_cents)}</span>
                </li>
              ))}
            </ul>
            {open.length === 0 ? (
              <Link className="button" to={`/reserve?student=${student.id}`}>
                Reserve an instrument
              </Link>
            ) : null}
          </section>
        );
      })}
    </main>
  );
}
