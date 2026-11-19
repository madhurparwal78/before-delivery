import { useCallback, useEffect, useState } from 'react';
import type { Billing as BillingView } from '../api.js';
import { call } from '../guard.js';
import { officeDate } from '../format.js';
import { useLive } from '../live.js';

const OUTAGE = "Billing can't be reached. Seat changes wait here and are not counted until billing confirms them.";

export function Billing(): React.ReactElement {
  const [billing, setBilling] = useState<BillingView | null>(null);

  const load = useCallback(() => {
    void call<BillingView>('/api/billing')
      .then(setBilling)
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  useLive('billing-changed', load);
  useLive('seat-confirmed', load);

  return (
    <main>
      <h1>Billing</h1>
      {billing !== null && !billing.reachable ? (
        <p className="band" role="alert">
          {OUTAGE}
        </p>
      ) : null}
      <div className="folder">
        <span className="folder-tab" aria-hidden="true">
          Seats
        </span>
        <div className="folder-band folder-band--surface">
          <div className="slip">
            <div className="slip-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
              <span>
                Seats in use
                <br />
                <strong className="count">{billing?.seats ?? '—'}</strong>
              </span>
              <span>
                Next invoice
                <br />
                <strong className="amount">
                  {billing?.next_invoice === null || billing?.next_invoice === undefined
                    ? '—'
                    : `$${billing.next_invoice.amount} on ${officeDate(billing.next_invoice.date)}`}
                </strong>
              </span>
              <span>
                Licence term ends
                <br />
                <strong className="figures">
                  {billing?.licence_term_ends_on === null || billing?.licence_term_ends_on === undefined
                    ? '—'
                    : officeDate(billing.licence_term_ends_on)}
                </strong>
              </span>
            </div>
          </div>
          <h2>Waiting on billing</h2>
          <ul className="slips" aria-label="Waiting on billing">
            {(billing?.waiting ?? []).map((entry) => (
              <li className="slip" key={`${entry.person_id}-${entry.change}`}>
                {entry.name} — {entry.change === 'add' ? 'new seat' : 'seat release'} — Waiting on billing
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
