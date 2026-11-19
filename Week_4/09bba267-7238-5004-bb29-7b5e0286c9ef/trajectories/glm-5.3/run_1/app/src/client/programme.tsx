import { useEffect, useState } from 'react';
import type { Performance } from '../shared/api-types';
import { api } from './api';
import { TopBar, UpdatesRegion } from './shell';
import { formatCents } from './seat-map-core';

export function ProgrammePage() {
  const [performances, setPerformances] = useState<Performance[]>([]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(interval);
  }, []);

  const load = async () => {
    const result = await api<{ performances: Performance[] }>('/api/performances');
    if (result.ok) setPerformances(result.value.performances);
  };

  return (
    <div className="page">
      <TopBar active="programme" />
      <UpdatesRegion />
      <main className="content programme">
        <h1>Programme</h1>
        {performances.map((performance) => (
          <article key={performance.id} aria-label={performance.title} className="programme-entry">
            <h2>{performance.title}</h2>
            <p className="start-label">{performance.startsAtVenue}</p>
            <ul className="tier-lines">
              {performance.tiers.map((tier) => (
                <li key={tier.id} className="tier-line">
                  <span>{tier.name}</span>
                  <span className="amount">{formatCents(tier.faceCents)}</span>
                  <span>{tier.remaining > 0 ? `${tier.remaining} left` : 'Sold out'}</span>
                </li>
              ))}
            </ul>
            {!performance.salesOpen && <p className="sales-closed">Sales closed</p>}
            {performance.salesOpen ? (
              <a className="choose-seats" href={`/p/${performance.id}`}>Choose seats</a>
            ) : null}
          </article>
        ))}
      </main>
    </div>
  );
}
