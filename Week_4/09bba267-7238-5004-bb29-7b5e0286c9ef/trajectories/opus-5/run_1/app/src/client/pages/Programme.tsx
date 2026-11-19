import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Performance } from '../../shared/api';
import { formatMoney } from '../../shared/money';
import { api } from '../lib/api';
import { useLiveUpdates } from '../lib/live';
import { Link } from '../lib/router';

export function Programme(): ReactNode {
  const [performances, setPerformances] = useState<Performance[]>([]);

  const refresh = useCallback(async () => {
    const result = await api.performances();
    if (result.data !== undefined) setPerformances(result.data.performances);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLiveUpdates({}, () => {
    void refresh();
  });

  return (
    <section className="programme">
      <h1>Programme</h1>
      <ul className="programme-list">
        {performances.map((performance) => (
          <li key={performance.id}>
            <article aria-label={performance.title}>
              <h2>{performance.title}</h2>
              <p className="start-label figures">{performance.startsAtVenue}</p>
              <ul className="tier-lines">
                {performance.tiers.map((tier) => (
                  <li key={tier.id}>
                    <span className="tier-name">{tier.name}</span>
                    <span className="figures">{formatMoney(tier.faceCents)}</span>
                    <span className="figures remaining">
                      {tier.remaining === 0 ? 'Sold out' : `${tier.remaining} left`}
                    </span>
                  </li>
                ))}
              </ul>
              {performance.salesOpen ? null : <p className="closed">Sales closed</p>}
              <Link
                to={`/p/${performance.id}`}
                className="action-link"
                label={`Choose seats for ${performance.title}`}
              >
                Choose seats
              </Link>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
